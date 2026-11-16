#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

void foliune_choose_local_photo_sources(
    void *parent,
    void *context,
    void (*complete)(void *, const char *const *, size_t)
) {
    NSWindow *window = (__bridge NSWindow *)parent;
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = @"选择照片或文件夹";
    panel.prompt = @"选择";
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = YES;
    panel.allowsMultipleSelection = YES;
    panel.allowedContentTypes = @[UTTypeJPEG, UTTypePNG, UTTypeWebP];

    [panel beginSheetModalForWindow:window completionHandler:^(NSModalResponse response) {
        if (response != NSModalResponseOK) {
            complete(context, NULL, 0);
            return;
        }
        __attribute__((objc_precise_lifetime)) NSArray<NSURL *> *urls = panel.URLs;
        __attribute__((objc_precise_lifetime)) NSMutableData *storage =
            [NSMutableData dataWithLength:urls.count * sizeof(const char *)];
        const char **paths = storage.mutableBytes;
        for (NSUInteger index = 0; index < urls.count; ++index) {
            paths[index] = urls[index].fileSystemRepresentation;
        }
        complete(context, paths, urls.count);
    }];
}
