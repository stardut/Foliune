#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <math.h>

@interface FoliuneContextMenuObserver : NSObject
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic, strong) NSEvent *pendingDown;
@property (nonatomic, strong) id monitor;
@end

@implementation FoliuneContextMenuObserver

- (void)invalidate:(NSNotification *)notification {
    (void)notification;
    self.pendingDown = nil;
}

- (void)detach:(NSNotification *)notification {
    (void)notification;
    if (self.monitor) [NSEvent removeMonitor:self.monitor];
    self.monitor = nil;
    self.pendingDown = nil;
    [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (void)dealloc {
    [self detach:nil];
}

@end

static char observerKey;

bool foliune_observe_context_menu(void *windowPtr) {
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    FoliuneContextMenuObserver *observer = [FoliuneContextMenuObserver new];
    observer.window = window;
    __weak FoliuneContextMenuObserver *weakObserver = observer;
    observer.monitor = [NSEvent addLocalMonitorForEventsMatchingMask:
        NSEventMaskRightMouseDown | NSEventMaskLeftMouseDown |
        NSEventMaskOtherMouseDown | NSEventMaskKeyDown
        handler:^NSEvent *(NSEvent *event) {
            FoliuneContextMenuObserver *current = weakObserver;
            BOOL contextDown = event.type == NSEventTypeRightMouseDown ||
                (event.type == NSEventTypeLeftMouseDown && (event.modifierFlags & NSEventModifierFlagControl));
            current.pendingDown = contextDown && event.window == current.window ? event : nil;
            return event;
        }];
    if (!observer.monitor) return false;
    objc_setAssociatedObject(window, &observerKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:observer selector:@selector(invalidate:) name:NSWindowDidResignKeyNotification object:window];
    [center addObserver:observer selector:@selector(invalidate:) name:NSApplicationDidResignActiveNotification object:NSApp];
    [center addObserver:observer selector:@selector(detach:) name:NSWindowWillCloseNotification object:window];
    return true;
}

bool foliune_popup_context_menu(void *menuPtr, void *viewPtr, double x, double y) {
    NSMenu *menu = (__bridge NSMenu *)menuPtr;
    NSView *view = (__bridge NSView *)viewPtr;
    NSWindow *window = view.window;
    FoliuneContextMenuObserver *observer = objc_getAssociatedObject(window, &observerKey);
    NSEvent *down = observer.pendingDown;
    observer.pendingDown = nil;
    if (!down || down.window != window) return false;
    NSPoint point = [view convertPoint:down.locationInWindow fromView:nil];
    NSPoint requested = NSMakePoint(x, view.frame.size.height - y);
    if (hypot(point.x - requested.x, point.y - requested.y) > 8) return false;
    // Keep the original event through menu construction and IPC. A later input,
    // loss of activation or consumption invalidates it; elapsed time alone does not.
    [NSMenu popUpContextMenu:menu withEvent:down forView:view];
    return true;
}
