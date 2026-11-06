use super::{
    source::{RootIdentity, RootStamp},
    sync::Candidate,
    Root,
};
use rusqlite::{params, Connection, Transaction};
use serde::Serialize;
use std::{collections::VecDeque, sync::Arc};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JobState {
    pub id: String,
    pub folder_name: String,
    pub album_id: String,
    pub created_album: bool,
    pub file_count: usize,
    pub processed: usize,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum JobStatus {
    Queued,
    Running,
    Failed,
}

#[derive(Clone)]
pub(super) struct Job {
    pub state: JobState,
    pub candidate: Arc<Candidate>,
    pub stamp: Option<RootStamp>,
    pub source: Option<RootIdentity>,
}

#[derive(Default)]
pub(super) struct Queue(VecDeque<Job>);

pub(super) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS work_directory_jobs (
           position INTEGER PRIMARY KEY,
           id TEXT NOT NULL UNIQUE,
           root_id TEXT NOT NULL REFERENCES work_directory_roots(id),
           folder TEXT NOT NULL,
           album_id TEXT NOT NULL,
           candidate TEXT NOT NULL,
           source_identity TEXT,
           error TEXT,
           processed INTEGER NOT NULL DEFAULT 0 CHECK(processed>=0),
           UNIQUE(root_id,folder)
         );",
    )
    .map_err(|e| e.to_string())
}

impl Job {
    fn new(candidate: Candidate, stamp: Option<RootStamp>) -> Self {
        let album_id = candidate
            .album_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut job = Self::from_record(
            Uuid::new_v4().to_string(),
            album_id,
            candidate,
            stamp.and_then(RootStamp::durable),
            None,
            0,
        );
        job.stamp = stamp;
        job
    }

    fn from_record(
        id: String,
        album_id: String,
        candidate: Candidate,
        source: Option<RootIdentity>,
        error: Option<String>,
        processed: usize,
    ) -> Self {
        Self {
            state: JobState {
                id,
                folder_name: candidate.folder_name.clone(),
                album_id,
                created_album: candidate.album_id.is_none(),
                file_count: candidate.file_names.len(),
                processed,
                // Running progress is deliberately in memory. On reopen an
                // unfinished album starts again with the exact confirmed files.
                status: if error.is_some() {
                    JobStatus::Failed
                } else {
                    JobStatus::Queued
                },
                error,
            },
            candidate: Arc::new(candidate),
            stamp: None,
            source,
        }
    }
}

fn source_text(source: Option<RootIdentity>) -> Result<Option<String>, String> {
    source
        .map(|source| serde_json::to_string(&source).map_err(|e| e.to_string()))
        .transpose()
}

impl Queue {
    pub fn load(conn: &Connection, root: &Root) -> Result<Self, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id,album_id,candidate,source_identity,error,processed FROM work_directory_jobs
                 WHERE root_id=?1 ORDER BY position",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([&root.id]).map_err(|e| e.to_string())?;
        let mut queue = VecDeque::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let candidate: String = row.get(2).map_err(|e| e.to_string())?;
            let source: Option<String> = row.get(3).map_err(|e| e.to_string())?;
            queue.push_back(Job::from_record(
                row.get(0).map_err(|e| e.to_string())?,
                row.get(1).map_err(|e| e.to_string())?,
                serde_json::from_str(&candidate).map_err(|e| e.to_string())?,
                source
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()
                    .map_err(|e| e.to_string())?,
                row.get(4).map_err(|e| e.to_string())?,
                row.get(5).map_err(|e| e.to_string())?,
            ));
        }
        Ok(Self(queue))
    }

    pub fn states(&self) -> Vec<JobState> {
        self.0.iter().map(|job| job.state.clone()).collect()
    }

    pub fn reserves_folder(&self, name: &str) -> bool {
        self.0.iter().any(|job| job.state.folder_name == name)
    }

    pub fn has_active(&self, album: Option<&str>) -> bool {
        self.0.iter().any(|job| {
            job.state.status != JobStatus::Failed
                && album.is_none_or(|album| job.state.album_id == album)
        })
    }

    pub fn has_running(&self) -> bool {
        self.0
            .iter()
            .any(|job| job.state.status == JobStatus::Running)
    }

    pub fn has_waiting(&self) -> bool {
        self.0
            .iter()
            .any(|job| job.state.status == JobStatus::Queued)
    }

    pub fn remove_album(&mut self, id: &str) {
        self.0.retain(|job| job.state.album_id != id);
    }

    pub fn enqueue(
        &mut self,
        conn: &mut Connection,
        root: &Root,
        candidates: Vec<Candidate>,
        stamp: Option<RootStamp>,
    ) -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        super::sync::validate_batch(&tx, root, &candidates)?;
        let mut jobs = Vec::with_capacity(candidates.len());
        let source = source_text(stamp.and_then(RootStamp::durable))?;
        for candidate in candidates {
            let job = Job::new(candidate, stamp);
            let candidate =
                serde_json::to_string(job.candidate.as_ref()).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO work_directory_jobs(id,root_id,folder,album_id,candidate,source_identity)
                 VALUES(?1,?2,?3,?4,?5,?6)",
                params![job.state.id, root.id, job.state.folder_name, job.state.album_id, candidate, source],
            )
            .map_err(|e| e.to_string())?;
            jobs.push(job);
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.0.extend(jobs);
        Ok(())
    }

    pub fn take_next(&mut self) -> Option<Job> {
        if self.has_running() {
            return None;
        }
        let job = self
            .0
            .iter_mut()
            .find(|job| job.state.status == JobStatus::Queued)?;
        job.state.status = JobStatus::Running;
        Some(job.clone())
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.0
            .iter()
            .any(|job| job.state.id == id && job.state.status == JobStatus::Running)
    }

    pub fn progress(&mut self, id: &str, processed: usize) -> bool {
        let Some(job) = self.running(id) else {
            return false;
        };
        job.state.processed = processed;
        true
    }

    pub fn pause(&mut self, id: &str) {
        if let Some(job) = self.running(id) {
            job.state.status = JobStatus::Queued;
            job.state.processed = 0;
            job.stamp = None;
        }
    }

    pub fn clear_live_stamps(&mut self) {
        for job in &mut self.0 {
            job.stamp = None;
        }
    }

    pub fn complete(&mut self, id: &str) {
        self.0.retain(|job| job.state.id != id);
    }

    pub fn fail(&mut self, conn: &Connection, id: &str, error: String) -> Result<(), String> {
        let job = self.running(id).ok_or("同步任务已变化")?;
        let changed = conn
            .execute(
                "UPDATE work_directory_jobs SET error=?2,processed=?3 WHERE id=?1 AND error IS NULL",
                params![id, error, job.state.processed],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("同步任务已变化".into());
        }
        job.state.status = JobStatus::Failed;
        job.state.error = Some(error);
        Ok(())
    }

    pub fn retry(
        &mut self,
        conn: &Connection,
        id: &str,
        stamp: Option<RootStamp>,
    ) -> Result<(), String> {
        let index = self
            .0
            .iter()
            .position(|job| job.state.id == id && job.state.status == JobStatus::Failed)
            .ok_or("该同步任务已变化，请重新查看作品目录")?;
        let changed = conn
            .execute(
                "UPDATE work_directory_jobs SET error=NULL,processed=0,
                 position=(SELECT COALESCE(MAX(position),0)+1 FROM work_directory_jobs)
                 WHERE id=?1 AND error IS NOT NULL",
                [id],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("同步任务已变化".into());
        }
        let mut job = self.0.remove(index).ok_or("同步任务不存在")?;
        job.state.status = JobStatus::Queued;
        job.state.processed = 0;
        job.state.error = None;
        job.stamp = stamp;
        self.0.push_back(job);
        Ok(())
    }

    fn running(&mut self, id: &str) -> Option<&mut Job> {
        self.0
            .iter_mut()
            .find(|job| job.state.id == id && job.state.status == JobStatus::Running)
    }
}

pub(super) fn finish(tx: &Transaction<'_>, root: &Root, id: &str) -> Result<(), String> {
    let changed = tx
        .execute(
            "DELETE FROM work_directory_jobs WHERE id=?1 AND root_id=?2 AND error IS NULL",
            params![id, root.id],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("同步任务已变化".into());
    }
    Ok(())
}

pub(super) fn remove_root(tx: &Transaction<'_>, id: &str) -> Result<(), String> {
    tx.execute("DELETE FROM work_directory_jobs WHERE root_id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn retain_same_source(
    tx: &Transaction<'_>,
    id: &str,
    stamp: Option<RootStamp>,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM work_directory_jobs WHERE root_id=?1 AND source_identity IS NOT ?2",
        params![id, source_text(stamp.and_then(RootStamp::durable))?],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn remove_album(tx: &Transaction<'_>, id: &str) -> Result<(), String> {
    tx.execute("DELETE FROM work_directory_jobs WHERE album_id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
