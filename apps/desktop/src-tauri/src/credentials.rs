fn entry(provider: &str) -> Result<keyring::Entry, String> {
    crate::ai::provider(provider)?;
    keyring::Entry::new("app.foliune.desktop.ai", provider).map_err(|_| "无法访问系统凭据库".into())
}

pub fn get(provider: &str) -> Result<String, String> {
    entry(provider)?
        .get_password()
        .map_err(|error| match error {
            keyring::Error::NoEntry => "请先在设置中保存此服务的 API Key".into(),
            _ => "系统凭据库读取失败，请检查系统授权".into(),
        })
}

pub fn has(provider: &str) -> Result<bool, String> {
    match entry(provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("系统凭据库读取失败，请检查系统授权".into()),
    }
}

pub fn set(provider: &str, key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.contains('\n') || key.contains('\r') {
        return Err("API Key 不能为空或包含换行".into());
    }
    entry(provider)?
        .set_password(key.trim())
        .map_err(|_| "保存系统凭据失败".into())
}

pub fn delete(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("删除系统凭据失败".into()),
    }
}
