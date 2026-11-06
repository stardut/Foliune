#include <CFNetwork/CFProxySupport.h>
#include <CoreFoundation/CoreFoundation.h>
#include <string.h>

enum {
    PROXY_INVALID = -1,
    PROXY_DIRECT = 0,
    PROXY_HTTP = 1,
    PROXY_SOCKS = 2,
    PROXY_PAC = 3,
};

int foliune_link_import_proxy(const char *url, char *host, size_t host_size, int *port) {
    CFDictionaryRef settings = CFNetworkCopySystemProxySettings();
    if (!settings) {
        return PROXY_DIRECT;
    }
    CFURLRef target = CFURLCreateWithBytes(kCFAllocatorDefault, (const UInt8 *)url,
                                         (CFIndex)strlen(url), kCFStringEncodingUTF8, NULL);
    CFArrayRef routes = target ? CFNetworkCopyProxiesForURL(target, settings) : NULL;
    if (target) {
        CFRelease(target);
    }
    CFRelease(settings);
    if (!routes) {
        return PROXY_INVALID;
    }

    int result = PROXY_INVALID;
    // Use the preferred system route, with no fallback on connection failure.
    if (CFArrayGetCount(routes) > 0) {
        CFDictionaryRef route = CFArrayGetValueAtIndex(routes, 0);
        CFStringRef type = CFDictionaryGetValue(route, kCFProxyTypeKey);
        if (!type) {
            CFRelease(routes);
            return PROXY_INVALID;
        }
        if (CFEqual(type, kCFProxyTypeNone)) {
            result = PROXY_DIRECT;
        } else if (CFEqual(type, kCFProxyTypeAutoConfigurationURL) ||
                   CFEqual(type, kCFProxyTypeAutoConfigurationJavaScript)) {
            result = PROXY_PAC;
        } else if (CFEqual(type, kCFProxyTypeHTTP) || CFEqual(type, kCFProxyTypeHTTPS) ||
                   CFEqual(type, kCFProxyTypeSOCKS)) {
            CFStringRef name = CFDictionaryGetValue(route, kCFProxyHostNameKey);
            CFNumberRef number = CFDictionaryGetValue(route, kCFProxyPortNumberKey);
            if (name && CFStringGetLength(name) > 0 && number &&
                CFNumberGetValue(number, kCFNumberIntType, port) && *port > 0 &&
                CFStringGetCString(name, host, (CFIndex)host_size, kCFStringEncodingUTF8)) {
                result = CFEqual(type, kCFProxyTypeSOCKS) ? PROXY_SOCKS : PROXY_HTTP;
            }
        }
    }
    CFRelease(routes);
    return result;
}
