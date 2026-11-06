use std::time::Duration;
use tauri::Url;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Platform {
    Xhs,
    Instagram,
}
#[derive(Clone, Debug)]
pub(super) struct Target {
    pub url: Url,
    pub canonical: String,
    pub id: String,
    pub platform: Platform,
}

pub(super) fn secure(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
}
fn short_host(host: &str) -> bool {
    [
        "xhslink.com",
        "www.xhslink.com",
        "xhslink.cn",
        "www.xhslink.cn",
    ]
    .contains(&host)
}
pub(super) fn page_allowed(url: &Url, platform: Platform) -> bool {
    secure(url)
        && url.host_str().is_some_and(|host| match platform {
            Platform::Xhs => ["xiaohongshu.com", "www.xiaohongshu.com"].contains(&host),
            Platform::Instagram => ["instagram.com", "www.instagram.com"].contains(&host),
        })
}
fn short_allowed(url: &Url) -> bool {
    secure(url) && url.host_str().is_some_and(short_host)
}
pub(super) fn media_allowed(url: &Url, platform: Platform) -> bool {
    secure(url)
        && url.host_str().is_some_and(|host| {
            let suffixes: &[&str] = match platform {
                Platform::Xhs => &["xhscdn.com"],
                Platform::Instagram => &["cdninstagram.com", "fbcdn.net"],
            };
            suffixes
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        })
}
pub(super) fn input_url(input: &str) -> Result<Url, String> {
    if input.len() > 16_384 {
        return Err("分享内容过长，请只粘贴单篇帖子链接。".into());
    }
    let mut urls = Vec::new();
    let mut rest = input;
    while let Some(index) = rest.find("http") {
        rest = &rest[index..];
        if !rest.starts_with("https://") && !rest.starts_with("http://") {
            rest = &rest[4..];
            continue;
        }
        let end = rest
            .find(|c: char| c.is_whitespace() || "<>\"'「」【】（）。，！；".contains(c))
            .unwrap_or(rest.len());
        let value = rest[..end].trim_end_matches(['.', ',', ')', ']', '!', ';']);
        let mut url = Url::parse(value).map_err(|_| "链接格式无效")?;
        if url.scheme() == "http" && url.host_str().is_some_and(short_host) && url.port().is_none()
        {
            let _ = url.set_scheme("https");
        }
        if !urls.contains(&url) {
            urls.push(url);
        }
        rest = &rest[end..];
    }
    if urls.len() != 1 {
        return Err("请粘贴一个小红书或 Instagram 单篇帖子链接。".into());
    }
    let url = urls.remove(0);
    if !(short_allowed(&url)
        || page_allowed(&url, Platform::Xhs)
        || page_allowed(&url, Platform::Instagram))
    {
        return Err("仅支持 HTTPS 小红书或 Instagram 单篇帖子链接。".into());
    }
    Ok(url)
}
pub(super) fn target(url: Url) -> Result<Target, String> {
    let parts: Vec<_> = url
        .path_segments()
        .ok_or("帖子路径无效")?
        .filter(|s| !s.is_empty())
        .collect();
    let platform = if page_allowed(&url, Platform::Xhs) {
        Platform::Xhs
    } else if page_allowed(&url, Platform::Instagram) {
        Platform::Instagram
    } else {
        return Err("短链接未指向受支持的帖子。".into());
    };
    let id = match platform {
        Platform::Xhs => match parts.as_slice() {
            ["explore", id] | ["discovery", "item", id]
                if id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()) =>
            {
                (*id).to_string()
            }
            _ => return Err("请使用小红书单篇笔记链接。".into()),
        },
        Platform::Instagram => match parts.as_slice() {
            ["p", id] | [_, "p", id]
                if !id.is_empty()
                    && id.len() <= 64
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') =>
            {
                (*id).to_string()
            }
            _ => return Err("首版仅支持 Instagram 静态图片帖（/p/ 链接）。".into()),
        },
    };
    let canonical = match platform {
        Platform::Xhs => format!("https://www.xiaohongshu.com/explore/{id}"),
        Platform::Instagram => format!("https://www.instagram.com/p/{id}/"),
    };
    Ok(Target {
        url,
        canonical,
        id,
        platform,
    })
}
pub(super) async fn resolve(input: &str) -> Result<Target, String> {
    let mut url = input_url(input)?;
    if !short_allowed(&url) {
        return target(url);
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法初始化链接解析")?;
    for _ in 0..5 {
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "短链接解析失败或超时，请使用笔记完整链接。")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("短链接跳转缺少目标地址")?;
            url = url.join(location).map_err(|_| "短链接跳转地址无效")?;
            if page_allowed(&url, Platform::Xhs) {
                return target(url);
            }
            if !short_allowed(&url) {
                return Err("短链接跳转到不受支持的地址，已停止。".into());
            }
        } else {
            return Err("短链接未返回笔记跳转，请使用完整笔记链接。".into());
        }
    }
    Err("短链接跳转次数过多。".into())
}
