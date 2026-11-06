#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <math.h>
#include <stdint.h>

static CFDictionaryRef image_option(CFStringRef key, CFTypeRef value) {
    const void *keys[] = {key};
    const void *values[] = {value};
    return CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks,
                              &kCFTypeDictionaryValueCallBacks);
}

// Map EXIF's upper-left origin to Quartz's lower-left origin.
static CGAffineTransform orientation_transform(uint32_t orientation, CGFloat w, CGFloat h) {
    switch (orientation) {
        case 2: return CGAffineTransformMake(-1,  0,  0,  1, w, 0);
        case 3: return CGAffineTransformMake(-1,  0,  0, -1, w, h);
        case 4: return CGAffineTransformMake( 1,  0,  0, -1, 0, h);
        case 5: return CGAffineTransformMake( 0, -1, -1,  0, h, w);
        case 6: return CGAffineTransformMake( 0, -1,  1,  0, 0, w);
        case 7: return CGAffineTransformMake( 0,  1,  1,  0, 0, 0);
        case 8: return CGAffineTransformMake( 0,  1, -1,  0, h, 0);
        default: return CGAffineTransformIdentity;
    }
}

static CGImageRef render_thumbnail(CGImageRef image, size_t w, size_t h, uint32_t orientation,
                                   bool swap_axes) {
    // Drawing into sRGB converts pixels using the source color space, including embedded ICC.
    CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (!srgb) return NULL;
    CGContextRef bitmap = CGBitmapContextCreate(NULL, swap_axes ? h : w, swap_axes ? w : h,
                                                8, 0, srgb, kCGImageAlphaNoneSkipLast);
    CGColorSpaceRelease(srgb);
    if (!bitmap) return NULL;

    CGContextSetInterpolationQuality(bitmap, kCGInterpolationMedium);
    CGContextConcatCTM(bitmap, orientation_transform(orientation, w, h));
    CGContextDrawImage(bitmap, CGRectMake(0, 0, w, h), image);
    CGImageRef thumbnail = CGBitmapContextCreateImage(bitmap);
    CGContextRelease(bitmap);
    return thumbnail;
}

static CFDataRef encode_thumbnail(CGImageRef image) {
    const double quality = 0.53;
    CFNumberRef number = CFNumberCreate(NULL, kCFNumberDoubleType, &quality);
    if (!number) return NULL;
    CFDictionaryRef options = image_option(kCGImageDestinationLossyCompressionQuality, number);
    CFRelease(number);
    if (!options) return NULL;

    CFMutableDataRef data = CFDataCreateMutable(NULL, 0);
    CGImageDestinationRef destination = data ?
        CGImageDestinationCreateWithData(data, CFSTR("public.jpeg"), 1, NULL) : NULL;
    bool complete = false;
    if (destination) {
        // Image I/O tags the sRGB bitmap with EXIF ColorSpace=1. Source metadata stays private.
        CGImageDestinationAddImage(destination, image, options);
        complete = CGImageDestinationFinalize(destination);
        CFRelease(destination);
    }
    CFRelease(options);
    if (complete && CFDataGetLength(data) > 0) return data;
    if (data) CFRelease(data);
    return NULL;
}

// On success, output owns a CFData reference. Error codes are shared with jpeg_macos.rs.
int foliune_prepare_jpeg(const uint8_t *bytes, size_t len, uint32_t width, uint32_t height,
                         uint32_t orientation, uint32_t max_edge, CFDataRef *output) {
    CFDataRef data = CFDataCreateWithBytesNoCopy(NULL, bytes, (CFIndex)len, kCFAllocatorNull);
    if (!data) return 1;
    CGImageSourceRef source = CGImageSourceCreateWithData(data, NULL);
    CFRelease(data);
    if (!source) return 1;

    int result = 1;
    CGImageRef image = NULL;
    CGImageRef thumbnail = NULL;
    CFStringRef type = CGImageSourceGetType(source);
    if (!type || !CFEqual(type, CFSTR("public.jpeg"))) goto done;
    // Use the full image source and defer decoding to the draw. Eager caching
    // took longer with this borrowed CFData source on macOS 15.
    image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    if (!image || CGImageGetWidth(image) != width || CGImageGetHeight(image) != height) goto done;

    double scale = fmin(1.0, (double)max_edge / (width > height ? width : height));
    bool swap_axes = orientation >= 5 && orientation <= 8;
    thumbnail = render_thumbnail(image, fmax(1.0, round(width * scale)),
                                 fmax(1.0, round(height * scale)), orientation, swap_axes);
    if (CGImageSourceGetStatusAtIndex(source, 0) != kCGImageStatusComplete) goto done;
    result = 2;

done:
    if (image) CGImageRelease(image);
    CFRelease(source);
    if (thumbnail) {
        if (result == 2) {
            *output = encode_thumbnail(thumbnail);
            if (*output) result = 0;
        }
        CGImageRelease(thumbnail);
    }
    return result;
}
