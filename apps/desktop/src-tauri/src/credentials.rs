use crate::locale::tr;
fn entry(provider: &str) -> Result<keyring::Entry, String> {
    crate::ai::provider(provider)?;
    keyring::Entry::new("app.foliune.desktop.ai", provider).map_err(|_| {
        tr(
            "无法访问系统凭据库",
            "Could not access the system credential store",
        )
        .into()
    })
}

pub fn get(provider: &str) -> Result<String, String> {
    entry(provider)?
        .get_password()
        .map_err(|error| match error {
            keyring::Error::NoEntry => tr(
                "请先在设置中保存此服务的 API Key",
                "Save this provider's API key in Settings first",
            )
            .into(),
            _ => tr(
                "系统凭据库读取失败，请检查系统授权",
                "Could not read the system credential store. Check system permissions.",
            )
            .into(),
        })
}

pub fn has(provider: &str) -> Result<bool, String> {
    match entry(provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err(tr(
            "系统凭据库读取失败，请检查系统授权",
            "Could not read the system credential store. Check system permissions.",
        )
        .into()),
    }
}

pub fn set(provider: &str, key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.contains('\n') || key.contains('\r') {
        return Err(tr(
            "API Key 不能为空或包含换行",
            "The API key must not be empty or contain line breaks",
        )
        .into());
    }
    entry(provider)?
        .set_password(key.trim())
        .map_err(|_| tr("保存系统凭据失败", "Could not save the system credential").into())
}

pub fn delete(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(tr("删除系统凭据失败", "Could not delete the system credential").into()),
    }
}
