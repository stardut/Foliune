use super::{
    input::{media_allowed, Platform},
    Session,
};
use std::time::Duration;
use tauri::Url;

const MAX_BYTES: usize = 40 * 1024 * 1024;
const MAX_TOTAL: usize = 512 * 1024 * 1024;

pub(super) struct Download {
    client: reqwest::Client,
    urls: std::vec::IntoIter<Url>,
    referer: &'static str,
    bytes_received: usize,
}

impl Download {
    pub(super) fn new(images: Vec<String>, platform: Platform) -> Result<Self, String> {
        if images.is_empty() || images.len() > 100 {
            return Err("帖子图片数量无效或超过 100 张限制。".into());
        }
        let urls = images
            .into_iter()
            .map(|image| {
                let url = Url::parse(&image).map_err(|_| "帖子图片地址无效")?;
                if !media_allowed(&url, platform) {
                    return Err("帖子图片地址不在该平台受限 CDN 范围内。");
                }
                Ok(url)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25));
        #[cfg(target_os = "macos")]
        let client = with_system_proxy(client, &urls)?;
        let client = client.build().map_err(|_| "无法初始化图片下载")?;
        let referer = match platform {
            Platform::Xhs => "https://www.xiaohongshu.com/",
            Platform::Instagram => "https://www.instagram.com/",
        };
        Ok(Self {
            client,
            urls: urls.into_iter(),
            referer,
            bytes_received: 0,
        })
    }

    pub(super) fn count(&self) -> usize {
        self.urls.len()
    }

    pub(super) async fn next(&mut self, session: &Session) -> Result<Option<Vec<u8>>, String> {
        session.check()?;
        let Some(url) = self.urls.next() else {
            return Ok(None);
        };
        let mut response = self
            .client
            .get(url)
            .header("Referer", self.referer)
            .send()
            .await
            .map_err(|_| "图片下载失败或超时。")?;
        if !response.status().is_success() {
            return Err(format!(
                "图片下载返回 HTTP {}，未导入任何图片。",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
        {
            return Err("单张图片超过 40 MiB 限制。".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "图片下载中断或超时。")?
        {
            session.check()?;
            if bytes.len() + chunk.len() > MAX_BYTES
                || self.bytes_received + chunk.len() > MAX_TOTAL
            {
                return Err("图片下载超过会话大小限制。".into());
            }
            self.bytes_received += chunk.len();
            bytes.extend_from_slice(&chunk);
        }
        session.check()?;
        Ok(Some(bytes))
    }
}

#[cfg(target_os = "macos")]
fn with_system_proxy(
    client: reqwest::ClientBuilder,
    urls: &[Url],
) -> Result<reqwest::ClientBuilder, String> {
    use std::{
        collections::{hash_map::Entry, HashMap},
        ffi::{c_char, c_int, CStr, CString},
    };

    extern "C" {
        fn foliune_link_import_proxy(
            url: *const c_char,
            host: *mut c_char,
            host_size: usize,
            port: *mut c_int,
        ) -> c_int;
    }

    let mut proxies = HashMap::new();
    for url in urls {
        let host = url.host_str().ok_or("帖子图片地址无效")?;
        let Entry::Vacant(entry) = proxies.entry(host.to_owned()) else {
            continue;
        };
        let url = CString::new(url.as_str()).map_err(|_| "帖子图片地址无效")?;
        let mut proxy_host = [0; 1024];
        let mut port = 0;
        // The native resolver writes a NUL-terminated host on successful proxy lookup.
        let route = unsafe {
            foliune_link_import_proxy(
                url.as_ptr(),
                proxy_host.as_mut_ptr(),
                proxy_host.len(),
                &mut port,
            )
        };
        let scheme = match route {
            0 => {
                entry.insert(None);
                continue;
            }
            1 => "http",
            2 => "socks5h",
            3 => return Err("图片下载暂不支持 macOS 自动代理配置（PAC）。".into()),
            _ => return Err("无法读取 macOS 图片下载代理设置。".into()),
        };
        let invalid = "macOS 图片下载代理地址无效。";
        let proxy_host = unsafe { CStr::from_ptr(proxy_host.as_ptr()) }
            .to_str()
            .map_err(|_| invalid)?;
        let mut proxy = Url::parse(&format!("{scheme}://localhost")).map_err(|_| invalid)?;
        if let Ok(ip) = proxy_host.parse() {
            proxy.set_ip_host(ip).map_err(|_| invalid)?;
        } else {
            proxy.set_host(Some(proxy_host)).map_err(|_| invalid)?;
        }
        proxy
            .set_port(Some(u16::try_from(port).map_err(|_| invalid)?))
            .map_err(|_| invalid)?;
        entry.insert(Some(proxy));
    }

    // An explicit matcher also disables reqwest's environment-based proxy discovery.
    Ok(client.proxy(reqwest::Proxy::custom(move |url| {
        proxies.get(url.host_str()?).cloned().flatten()
    })))
}
