use super::NOT_FOUND;
use crate::{
    books::{self, BookDetail, VersionInput},
    db,
    model_profiles::{self, ModelInput, ModelProfile},
    planning::{self, PlanPart, PlanPriority, PlanShot, ShootPlan, ShootPlanInput},
};
use rusqlite::Connection;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use std::{cmp::Reverse, collections::HashMap};

#[derive(Clone, Copy)]
pub(super) enum DocumentKind {
    Plan,
    Book,
    Model,
}

pub(super) fn search(
    conn: &Connection,
    kind: DocumentKind,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<Value, String> {
    let query = query.trim().to_lowercase();
    match kind {
        DocumentKind::Plan => {
            let mut plans = planning::list(conn)?;
            plans.sort_by_cached_key(|plan| {
                (
                    Reverse(plan.input.execution_date.clone()),
                    Reverse(chrono::DateTime::parse_from_rfc3339(&plan.updated_at).ok()),
                    plan.id.clone(),
                )
            });
            let matches = plans.into_iter().filter(|plan| {
                query.is_empty()
                    || plan_search_text(&plan.input)
                        .to_lowercase()
                        .contains(&query)
            });
            page(matches, limit, offset, |plan| {
                Ok(json!({
                    "id": plan.id, "title": plan.input.title, "executionDate": plan.input.execution_date,
                    "shootDate": plan.input.shoot_date, "location": plan.input.location,
                    "updatedAt": plan.updated_at, "revision": plan.updated_at,
                }))
            })
        }
        DocumentKind::Book => {
            let matches = books::list(conn)?
                .into_iter()
                .filter(|book| book.title.to_lowercase().contains(&query));
            page(matches, limit, offset, |book| {
                revised(&book, &book.updated_at)
            })
        }
        DocumentKind::Model => {
            let matches = model_profiles::list(conn)?.into_iter().filter(|model| {
                query.is_empty()
                    || model_search_text(&model.input)
                        .to_lowercase()
                        .contains(&query)
            });
            page(matches, limit, offset, |model| {
                Ok(json!({
                    "id": model.id, "name": model.input.name, "city": model.input.city,
                    "tags": model.input.tags, "updatedAt": model.updated_at, "revision": model.updated_at,
                }))
            })
        }
    }
}

fn page<T>(
    matches: impl Iterator<Item = T>,
    limit: usize,
    offset: usize,
    summary: impl Fn(T) -> Result<Value, String>,
) -> Result<Value, String> {
    let mut items = Vec::new();
    let mut total = 0;
    for item in matches {
        if total >= offset && items.len() < limit {
            items.push(summary(item)?);
        }
        total += 1;
    }
    Ok(json!({ "items": items, "total": total, "limit": limit, "offset": offset }))
}

pub(super) fn show(conn: &Connection, kind: DocumentKind, id: &str) -> Result<Value, String> {
    match kind {
        DocumentKind::Plan => {
            let plan = get_plan(conn, id)?;
            revised(&plan, &plan.updated_at)
        }
        DocumentKind::Book => {
            let detail = get_book(conn, id)?;
            revised(&detail, &detail.book.updated_at)
        }
        DocumentKind::Model => {
            let model = get_model(conn, id)?;
            revised(&model, &model.updated_at)
        }
    }
}

pub(super) fn create(
    conn: &mut Connection,
    kind: DocumentKind,
    data: Value,
) -> Result<Value, String> {
    match kind {
        DocumentKind::Plan => {
            let input = plan_input(ShootPlanInput::default(), object(data)?)?;
            let plan = planning::save(conn, None, input)?;
            revised(&plan, &plan.updated_at)
        }
        DocumentKind::Book => {
            let detail = books::create(conn, deserialize(data)?)?;
            revised(&detail, &detail.book.updated_at)
        }
        DocumentKind::Model => {
            let input = overlay(&ModelInput::default(), object(data)?)?;
            let model = model_profiles::save(conn, None, input)?;
            revised(&model, &model.updated_at)
        }
    }
}

pub(super) fn update(
    conn: &mut Connection,
    kind: DocumentKind,
    id: &str,
    expected_revision: &str,
    data: Value,
) -> Result<Value, String> {
    let data = object(data)?;
    if data.is_empty() {
        return Err("请提供要更新的字段".into());
    }
    match kind {
        DocumentKind::Plan => {
            let plan = get_plan(conn, id)?;
            db::check_revision(&plan.updated_at, expected_revision)?;
            let input = plan_input(plan.input, data)?;
            let saved = planning::update(conn, id, expected_revision, input)?;
            revised(&saved, &saved.updated_at)
        }
        DocumentKind::Book => {
            let detail = get_book(conn, id)?;
            db::check_revision(&detail.book.updated_at, expected_revision)?;
            update_book(conn, detail, expected_revision, data)
        }
        DocumentKind::Model => {
            let model = get_model(conn, id)?;
            db::check_revision(&model.updated_at, expected_revision)?;
            let input = overlay(&model.input, data)?;
            let saved = model_profiles::update(conn, id, expected_revision, input)?;
            revised(&saved, &saved.updated_at)
        }
    }
}

pub(super) fn delete(
    conn: &mut Connection,
    kind: DocumentKind,
    id: &str,
    expected_revision: &str,
) -> Result<Value, String> {
    match kind {
        DocumentKind::Plan => {
            db::check_revision(&get_plan(conn, id)?.updated_at, expected_revision)?;
            planning::delete_record(conn, id)?;
        }
        DocumentKind::Book => {
            db::check_revision(&get_book(conn, id)?.book.updated_at, expected_revision)?;
            books::delete_record(conn, id)?;
        }
        DocumentKind::Model => {
            db::check_revision(&get_model(conn, id)?.updated_at, expected_revision)?;
            model_profiles::delete_record(conn, id)?;
        }
    }
    Ok(json!({ "id": id }))
}

fn get_plan(conn: &Connection, id: &str) -> Result<ShootPlan, String> {
    map_not_found(planning::get(conn, id), "拍摄策划不存在")
}

fn get_book(conn: &Connection, id: &str) -> Result<BookDetail, String> {
    map_not_found(books::get(conn, id), "画册不存在")
}

fn get_model(conn: &Connection, id: &str) -> Result<ModelProfile, String> {
    map_not_found(model_profiles::get(conn, id), "模特档案不存在")
}

fn map_not_found<T>(result: Result<T, String>, not_found: &str) -> Result<T, String> {
    result.map_err(|error| {
        if error == not_found {
            NOT_FOUND.into()
        } else {
            error
        }
    })
}

fn revised(value: &impl Serialize, revision: &str) -> Result<Value, String> {
    let mut result = object(serialize(value)?)?;
    result.insert("revision".into(), Value::String(revision.into()));
    Ok(Value::Object(result))
}

fn object(value: Value) -> Result<Map<String, Value>, String> {
    match value {
        Value::Object(object) => Ok(object),
        _ => Err("数据须为 JSON 对象".into()),
    }
}

fn serialize(value: &impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn deserialize<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn overlay<T: Serialize + DeserializeOwned>(
    previous: &T,
    patch: Map<String, Value>,
) -> Result<T, String> {
    let mut data = object(serialize(previous)?)?;
    data.extend(patch);
    deserialize(Value::Object(data))
}

fn update_book(
    conn: &mut Connection,
    detail: BookDetail,
    expected_revision: &str,
    mut data: Map<String, Value>,
) -> Result<Value, String> {
    let title = data
        .remove("title")
        .map(deserialize::<String>)
        .transpose()?;
    let [version] = detail.versions;
    let version = data
        .remove("version")
        .map(|patch| {
            let patch = object(patch)?;
            if patch.is_empty() {
                return Err("请提供要更新的画册内容字段".into());
            }
            if patch.contains_key("reflowUndoId") {
                return Err("画册的历史排版来源字段不能更新".into());
            }
            overlay::<VersionInput>(&version.input, patch)
        })
        .transpose()?;
    if let Some(key) = data.keys().next() {
        return Err(format!("未知画册字段 {key}"));
    }
    let saved = books::update(
        conn,
        &detail.book.id,
        expected_revision,
        title.as_deref(),
        version,
    )?;
    revised(&saved, &saved.book.updated_at)
}

fn plan_input(
    mut previous: ShootPlanInput,
    mut patch: Map<String, Value>,
) -> Result<ShootPlanInput, String> {
    if let Some(parts) = patch.remove("parts") {
        let shots = previous
            .parts
            .iter()
            .flat_map(|part| &part.shots)
            .map(|shot| (shot.id.as_str(), shot))
            .collect::<HashMap<_, _>>();
        previous.parts = deserialize::<Vec<Map<String, Value>>>(parts)?
            .into_iter()
            .map(|part| plan_part(&previous.parts, &shots, part))
            .collect::<Result<_, _>>()?;
    }
    overlay(&previous, patch)
}

fn plan_part(
    previous: &[PlanPart],
    previous_shots: &HashMap<&str, &PlanShot>,
    mut patch: Map<String, Value>,
) -> Result<PlanPart, String> {
    let id = node_id(&patch)?;
    let mut part = previous
        .iter()
        .find(|part| part.id == id)
        .cloned()
        .unwrap_or_default();
    keep_legacy(&mut patch, "shotList", &part.shot_list)?;
    if let Some(shots) = patch.remove("shots") {
        part.shots = deserialize::<Vec<Map<String, Value>>>(shots)?
            .into_iter()
            .map(|shot| plan_shot(previous_shots, shot))
            .collect::<Result<_, _>>()?;
    }
    overlay(&part, patch)
}

fn plan_shot(
    previous: &HashMap<&str, &PlanShot>,
    mut patch: Map<String, Value>,
) -> Result<PlanShot, String> {
    let id = node_id(&patch)?;
    let shot = previous
        .get(id)
        .copied()
        .cloned()
        .unwrap_or_else(|| PlanShot {
            id: String::new(),
            title: String::new(),
            description: String::new(),
            pose: String::new(),
            composition: String::new(),
            lighting: String::new(),
            mood: String::new(),
            priority: PlanPriority::Normal,
            references: Vec::new(),
        });
    keep_legacy(&mut patch, "references", &shot.references)?;
    overlay(&shot, patch)
}

fn node_id(node: &Map<String, Value>) -> Result<&str, String> {
    node.get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "场景和镜头须提供字符串 id".into())
}

fn keep_legacy(
    patch: &mut Map<String, Value>,
    field: &str,
    previous: &impl Serialize,
) -> Result<(), String> {
    if let Some(new) = patch.remove(field) {
        if new != serialize(previous)? {
            return Err(format!("不能更改历史字段 {field}"));
        }
    }
    Ok(())
}

fn plan_search_text(plan: &ShootPlanInput) -> String {
    let mut fields = vec![
        plan.title.as_str(),
        &plan.concept,
        &plan.execution_date,
        &plan.shoot_date,
        &plan.location,
        &plan.team,
        &plan.deliverables,
        &plan.visual_direction,
        &plan.styling,
        &plan.props,
        &plan.equipment,
        &plan.preparation,
    ];
    fields.extend(
        plan.references
            .iter()
            .map(|reference| reference.intent.as_str()),
    );
    for part in &plan.parts {
        fields.extend([
            part.title.as_str(),
            &part.time_window,
            &part.description,
            &part.lighting,
            &part.focal_length,
            &part.scene,
            &part.styling,
            &part.mood,
        ]);
        fields.extend(
            part.references
                .iter()
                .map(|reference| reference.intent.as_str()),
        );
        for shot in &part.shots {
            fields.extend([
                shot.title.as_str(),
                &shot.description,
                &shot.pose,
                &shot.composition,
                &shot.lighting,
                &shot.mood,
            ]);
            fields.extend(
                shot.references
                    .iter()
                    .map(|reference| reference.intent.as_str()),
            );
        }
    }
    fields.join(" ")
}

fn model_search_text(model: &ModelInput) -> String {
    let mut fields = vec![
        model.name.as_str(),
        &model.city,
        &model.contact,
        &model.notes,
    ];
    fields.extend(model.tags.iter().map(String::as_str));
    fields.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planning::PlanReference;

    #[test]
    fn retained_and_moved_nodes_keep_legacy_data() {
        let reference = PlanReference {
            id: "reference-1".into(),
            photo_id: "photo-1".into(),
            intent: "边缘光".into(),
        };
        let mut initial = plan_input(ShootPlanInput::default(), object(json!({
            "references": [{ "id": "overview-reference", "photoId": "photo-1", "intent": "整体视觉" }],
            "parts": [
                { "id": "a", "shots": [{ "id": "shot", "title": "环境人像" }] },
                { "id": "b" }
            ]
        })).unwrap()).unwrap();
        initial.parts[0].shot_list = "旧补拍清单".into();
        initial.parts[0].shots[0].references = vec![reference.clone()];

        let update = object(json!({
            "parts": [
                { "id": "a", "shots": [] },
                { "id": "b", "shots": [{ "id": "shot", "pose": "回头" }] }
            ]
        }))
        .unwrap();
        let moved = plan_input(initial.clone(), update).unwrap();
        assert_eq!(moved.references, initial.references);
        assert_eq!(moved.parts[0].shot_list, "旧补拍清单");
        let shot = &moved.parts[1].shots[0];
        assert_eq!(shot.title, "环境人像");
        assert_eq!(shot.pose, "回头");
        assert_eq!(shot.references, [reference]);

        let clear = object(json!({ "references": [] })).unwrap();
        assert!(plan_input(moved.clone(), clear)
            .unwrap()
            .references
            .is_empty());
        let invalid = object(json!({
            "parts": [{ "id": "b", "shots": [{ "id": "shot", "references": [] }] }]
        }))
        .unwrap();
        assert!(plan_input(moved, invalid).is_err());
    }
}
