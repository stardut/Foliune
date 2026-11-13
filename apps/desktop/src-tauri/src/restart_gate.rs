use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{ipc::Invoke, Manager, Wry};

const UPDATING: &str = "正在更新应用。";

#[derive(Clone, Default)]
pub(crate) struct RestartGate(Arc<Mutex<State>>);

#[derive(Default, PartialEq)]
enum Phase {
    #[default]
    Idle,
    Installing,
    Restarting,
}

#[derive(Default)]
struct State {
    phase: Phase,
    active: usize,
}

impl RestartGate {
    fn state(&self) -> MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub(crate) fn active_work(&self) -> Option<ActiveWork<'_>> {
        let mut state = self.state();
        if state.phase != Phase::Idle {
            return None;
        }
        state.active += 1;
        Some(ActiveWork(self))
    }

    pub(crate) fn require_work(&self) -> Result<ActiveWork<'_>, String> {
        self.active_work().ok_or_else(|| UPDATING.into())
    }

    pub(crate) fn begin_install(&self) -> Option<Installation<'_>> {
        let mut state = self.state();
        if state.phase != Phase::Idle || state.active > 0 {
            return None;
        }
        state.phase = Phase::Installing;
        Some(Installation(self))
    }

    pub(crate) fn is_locked(&self) -> bool {
        self.state().phase != Phase::Idle
    }

    pub(crate) fn is_installing(&self) -> bool {
        self.state().phase == Phase::Installing
    }
}

pub(crate) fn protect_invocations(
    dispatch: impl Fn(Invoke<Wry>) -> bool,
) -> impl Fn(Invoke<Wry>) -> bool {
    move |invoke| {
        if invoke.message.command() == "install_app_update" {
            return dispatch(invoke);
        }
        let webview = invoke.message.webview();
        let Some(store) = webview.try_state::<crate::db::Store>() else {
            return dispatch(invoke);
        };
        let Some(_active) = store.restart_gate.active_work() else {
            invoke.resolver.reject(UPDATING);
            return true;
        };
        dispatch(invoke)
    }
}

pub(crate) struct ActiveWork<'a>(&'a RestartGate);

impl Drop for ActiveWork<'_> {
    fn drop(&mut self) {
        self.0.state().active -= 1;
    }
}

pub(crate) struct Installation<'a>(&'a RestartGate);

impl Installation<'_> {
    pub(crate) fn restarting(self) {
        self.0.state().phase = Phase::Restarting;
    }
}

impl Drop for Installation<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state();
        if state.phase == Phase::Installing {
            state.phase = Phase::Idle;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_work_and_installation_exclude_each_other() {
        let gate = RestartGate::default();
        let work = gate.active_work().unwrap();
        assert!(gate.begin_install().is_none());
        drop(work);

        let installation = gate.begin_install().unwrap();
        assert!(gate.active_work().is_none());
        assert!(gate.begin_install().is_none());
        drop(installation);
        assert!(gate.active_work().is_some());
    }

    #[test]
    fn successful_relaunch_keeps_work_frozen_until_exit() {
        let gate = RestartGate::default();
        gate.begin_install().unwrap().restarting();
        assert!(gate.is_locked());
        assert!(!gate.is_installing());
        assert!(gate.active_work().is_none());
        assert!(gate.begin_install().is_none());
    }
}
