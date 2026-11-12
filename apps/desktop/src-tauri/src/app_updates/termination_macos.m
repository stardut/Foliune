#import <AppKit/AppKit.h>
#import <objc/runtime.h>

typedef bool (*FoliuneIsInstallingUpdate)(const void *context);
typedef void (*FoliuneReleaseUpdateContext)(void *context);

@interface FoliuneUpdateTerminationDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) id<NSApplicationDelegate> original;
@property (nonatomic, assign) void *context;
@property (nonatomic, assign) FoliuneIsInstallingUpdate installing;
@property (nonatomic, assign) FoliuneReleaseUpdateContext releaseContext;
@end

@implementation FoliuneUpdateTerminationDelegate

- (BOOL)respondsToSelector:(SEL)selector {
    return [super respondsToSelector:selector] || [self.original respondsToSelector:selector];
}

- (id)forwardingTargetForSelector:(SEL)selector {
    if ([self.original respondsToSelector:selector]) return self.original;
    return [super forwardingTargetForSelector:selector];
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if (self.installing(self.context)) return NSTerminateCancel;
    if ([self.original respondsToSelector:_cmd]) {
        return [self.original applicationShouldTerminate:sender];
    }
    return NSTerminateNow;
}

- (void)dealloc {
    self.releaseContext(self.context);
}

@end

static char terminationDelegateKey;

bool foliune_observe_update_termination(void *context,
                                        FoliuneIsInstallingUpdate installing,
                                        FoliuneReleaseUpdateContext releaseContext) {
    if (![NSThread isMainThread] || !NSApp.delegate) return false;
    FoliuneUpdateTerminationDelegate *delegate = [FoliuneUpdateTerminationDelegate new];
    delegate.original = NSApp.delegate;
    delegate.context = context;
    delegate.installing = installing;
    delegate.releaseContext = releaseContext;
    objc_setAssociatedObject(NSApp, &terminationDelegateKey, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    // Preserve the framework delegate's existing callbacks through forwarding.
    NSApp.delegate = delegate;
    return true;
}
