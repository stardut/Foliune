#import <AppKit/AppKit.h>
#import <objc/runtime.h>

typedef void (*FoliuneFullscreenChanged)(const void *context, bool fullscreen);
typedef void (*FoliuneFullscreenRelease)(void *context);

@interface FoliuneFullscreenObserver : NSObject
@property (nonatomic, assign) void *context;
@property (nonatomic, assign) FoliuneFullscreenChanged changed;
@property (nonatomic, assign) FoliuneFullscreenRelease releaseContext;
@end

@implementation FoliuneFullscreenObserver

- (void)didEnter:(NSNotification *)notification {
    if (self.context) self.changed(self.context, true);
}

- (void)didExit:(NSNotification *)notification {
    // Let AppKit finish updating its responder chain before notifying WebKit.
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.context) self.changed(self.context, false);
    });
}

- (void)willClose:(NSNotification *)notification {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    if (self.context) {
        void *context = self.context;
        self.context = NULL;
        self.releaseContext(context);
    }
}

- (void)dealloc {
    [self willClose:nil];
}

@end

static char observerKey;

void foliune_observe_fullscreen(void *windowPtr, void *context,
                                FoliuneFullscreenChanged changed,
                                FoliuneFullscreenRelease releaseContext) {
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    FoliuneFullscreenObserver *observer = [FoliuneFullscreenObserver new];
    observer.context = context;
    observer.changed = changed;
    observer.releaseContext = releaseContext;
    objc_setAssociatedObject(window, &observerKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:observer selector:@selector(didEnter:) name:NSWindowDidEnterFullScreenNotification object:window];
    [center addObserver:observer selector:@selector(didExit:) name:NSWindowDidExitFullScreenNotification object:window];
    [center addObserver:observer selector:@selector(willClose:) name:NSWindowWillCloseNotification object:window];
}
