#import <AppKit/AppKit.h>

typedef void (*FoliuneAirDropCompletion)(void *context, const char *error);

@interface FoliuneAirDropSession : NSObject <NSSharingServiceDelegate>
@property (nonatomic, strong) NSSharingService *service;
@property (nonatomic, copy) NSArray<NSURL *> *files;
@property (nonatomic, weak) NSWindow *sourceWindow;
@property (nonatomic, assign) void *context;
@property (nonatomic, assign) FoliuneAirDropCompletion completion;
@end

// NSSharingService holds its delegate weakly. Keep both alive until AppKit finishes.
static FoliuneAirDropSession *activeSession;

@implementation FoliuneAirDropSession

- (void)finishWithError:(NSString *)error {
    FoliuneAirDropCompletion completion = self.completion;
    if (completion == NULL) {
        return;
    }
    void *context = self.context;
    self.completion = NULL;
    self.service.delegate = nil;
    activeSession = nil;
    completion(context, error.UTF8String);
}

- (NSWindow *)sharingService:(NSSharingService *)service
    sourceWindowForShareItems:(NSArray *)items
          sharingContentScope:(NSSharingContentScope *)scope {
    return self.sourceWindow;
}

- (void)sharingService:(NSSharingService *)service didShareItems:(NSArray *)items {
    [self finishWithError:nil];
}

- (void)sharingService:(NSSharingService *)service
      didFailToShareItems:(NSArray *)items
                    error:(NSError *)error {
    if ([error.domain isEqualToString:NSCocoaErrorDomain] && error.code == NSUserCancelledError) {
        [self finishWithError:nil];
    } else {
        [self finishWithError:[@"隔空投送失败：" stringByAppendingString:error.localizedDescription]];
    }
}

@end

void foliune_share_airdrop(void *window, const char *const *paths, size_t count,
                           void *context, FoliuneAirDropCompletion completion) {
    @autoreleasepool {
        NSMutableArray<NSURL *> *files = [NSMutableArray arrayWithCapacity:count];
        for (size_t index = 0; index < count; ++index) {
            [files addObject:[NSURL fileURLWithFileSystemRepresentation:paths[index]
                                                           isDirectory:NO
                                                         relativeToURL:nil]];
        }

        NSSharingService *service = [NSSharingService sharingServiceNamed:NSSharingServiceNameSendViaAirDrop];
        if (![service canPerformWithItems:files]) {
            completion(context, "系统无法打开隔空投送，请检查 Wi-Fi、蓝牙及隔空投送设置后重试。");
            return;
        }

        FoliuneAirDropSession *session = [FoliuneAirDropSession new];
        session.service = service;
        session.files = files;
        session.sourceWindow = (__bridge NSWindow *)window;
        session.context = context;
        session.completion = completion;
        activeSession = session;
        service.delegate = session;
        [service performWithItems:session.files];
    }
}
