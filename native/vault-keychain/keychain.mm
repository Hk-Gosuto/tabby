#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <node_api.h>
#include <sys/sysctl.h>
#include <string>
#include <algorithm>
#include "policy.h"

// Ordinary file-based Keychain for unsigned/ad-hoc build compatibility.
// Native operations authenticate before reading; this is application-enforced,
// not a biometric ACL on the Keychain item. No general-purpose decrypt API.
static NSDictionary *query() {
    return @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: @"org.tabby.vault.touchid.login.v1",
        (__bridge id)kSecAttrAccount: @"master-passphrase",
        (__bridge id)kSecUseDataProtectionKeychain: @NO,
        (__bridge id)kSecAttrSynchronizable: @NO,
    };
}

static NSString *bootSession() {
    char value[128] = {};
    size_t size = sizeof(value);
    if (sysctlbyname("kern.bootsessionuuid", value, &size, nullptr, 0) != 0) return nil;
    return [NSString stringWithUTF8String:value];
}

static std::string stringValue(NSString *value) {
    return value ? std::string(value.UTF8String) : std::string();
}

struct Job {
    napi_env env;
    napi_async_work work;
    napi_deferred deferred;
    std::string operation, input, output, code, message;
    bool noUI = false;
};

static void fail(Job *job, const char *code, const char *message) {
    job->code = code;
    job->message = message;
}

static void failStatus(Job *job, OSStatus status) {
    if (status == errSecUserCanceled || status == errSecAuthFailed || status == errSecInteractionNotAllowed) {
        fail(job, "AUTH_REQUIRED", "Touch ID was cancelled, failed, or is not available. Enter the master passphrase.");
    } else if (status == errSecItemNotFound) {
        fail(job, "CACHE_MISSING", "Touch ID must be enabled again with the master passphrase.");
    } else {
        // Do not include request payloads, Keychain data, or native errors in logs.
        fail(job, "KEYCHAIN_ERROR", "The protected Keychain operation failed. Use the master passphrase.");
    }
}

// The same native guard is used by enrollment and unlock. A diagnostic no-UI
// request can never authorize a read, including when a valid item exists.
static bool authenticate(Job *job, NSString *reason) {
    if (job->noUI) {
        fail(job, "AUTH_REQUIRED", "Touch ID was cancelled, failed, or is not available. Enter the master passphrase.");
        return false;
    }
    LAContext *context = [LAContext new];
    context.localizedFallbackTitle = @"";
    context.touchIDAuthenticationAllowableReuseDuration = 0;
    NSError *error = nil;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]) {
        [context invalidate];
        fail(job, "AUTH_REQUIRED", "Touch ID was cancelled, failed, or is not available. Enter the master passphrase.");
        return false;
    }
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL consent = NO;
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
            localizedReason:reason
                      reply:^(BOOL success, NSError *error) { (void)error; consent = success; dispatch_semaphore_signal(done); }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    [context invalidate];
    if (!consent) fail(job, "AUTH_REQUIRED", "Touch ID was cancelled, failed, or is not available. Enter the master passphrase.");
    return consent;
}

static void execute(napi_env, void *data) {
    Job *job = static_cast<Job *>(data);
    @autoreleasepool {
        @try {
            if (job->operation == "available") {
                LAContext *context = [LAContext new];
                NSError *error = nil;
                // Hardware capability; ordinary Keychain requires no access-group entitlement.
                job->output = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error] ? "true" : "false";
                return;
            }
            if (job->operation == "forget") {
                OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query());
                if (status != errSecSuccess && status != errSecItemNotFound) { failStatus(job, status); return; }
                job->output = "null";
                return;
            }

            if (job->operation == "store") {
                NSData *input = [NSData dataWithBytes:job->input.data() length:job->input.size()];
                NSDictionary *request = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
                if (![request isKindOfClass:[NSDictionary class]] ||
                    ![request[@"passphrase"] isKindOfClass:[NSString class]] ||
                    [request[@"passphrase"] length] == 0 || [request[@"passphrase"] length] > 16384 ||
                    ![request[@"expireDays"] isKindOfClass:[NSNumber class]] ||
                    ![request[@"expireOnRestart"] isKindOfClass:[NSNumber class]]) {
                    fail(job, "INVALID_REQUEST", "Invalid protected vault request."); return;
                }
                double days = [request[@"expireDays"] doubleValue];
                NSString *boot = bootSession();
                if (!boot || !std::isfinite(days) || days < 1 || days > 30 || std::floor(days) != days) {
                    fail(job, "INVALID_REQUEST", "Invalid protected vault expiry."); return;
                }

                if (!authenticate(job, @"Enable Touch ID for the Tabby vault")) return;

                double now = NSDate.date.timeIntervalSince1970;
                NSDictionary *record = @{
                    @"version": @2, @"passphrase": request[@"passphrase"],
                    @"createdAt": @(now), @"expiresAt": @(now + days * 86400),
                    @"uptime": @(NSProcessInfo.processInfo.systemUptime), @"boot": boot,
                    @"expireOnRestart": @([request[@"expireOnRestart"] boolValue]),
                };
                NSData *encoded = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
                // nil trusts only the creating application, not every application.
                // Ordinary Keychain may ask again after an ad-hoc binary changes.
                SecAccessRef access = nullptr;
                OSStatus status = SecAccessCreate(CFSTR("Tabby vault"), nullptr, &access);
                if (status != errSecSuccess) { failStatus(job, status); return; }
                NSMutableDictionary *attributes = [query() mutableCopy];
                attributes[(__bridge id)kSecAttrAccess] = (__bridge id)access;
                attributes[(__bridge id)kSecValueData] = encoded;
                attributes[(__bridge id)kSecAttrLabel] = @"Tabby vault (Touch ID in app)";
                status = SecItemDelete((__bridge CFDictionaryRef)query());
                if (status == errSecSuccess || status == errSecItemNotFound) {
                    status = SecItemAdd((__bridge CFDictionaryRef)attributes, nullptr);
                }
                CFRelease(access);
                if (status != errSecSuccess) { failStatus(job, status); return; }
                job->output = "null";
                return;
            }

            if (job->operation != "unlock") { fail(job, "INVALID_REQUEST", "Unknown vault operation."); return; }
            if (!authenticate(job, @"Unlock the Tabby vault")) return;
            NSMutableDictionary *read = [query() mutableCopy];
            read[(__bridge id)kSecReturnData] = @YES;
            read[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
            CFTypeRef result = nullptr;
            OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)read, &result);
            if (status != errSecSuccess) { if (result) CFRelease(result); failStatus(job, status); return; }
            NSData *encoded = CFBridgingRelease(result);
            NSDictionary *record = [NSJSONSerialization JSONObjectWithData:encoded options:0 error:nil];
            if (![record isKindOfClass:[NSDictionary class]] || [record[@"version"] intValue] != 2 ||
                ![record[@"passphrase"] isKindOfClass:[NSString class]] ||
                ![record[@"boot"] isKindOfClass:[NSString class]] ||
                ![record[@"createdAt"] isKindOfClass:[NSNumber class]] ||
                ![record[@"expiresAt"] isKindOfClass:[NSNumber class]] ||
                ![record[@"uptime"] isKindOfClass:[NSNumber class]] ||
                ![record[@"expireOnRestart"] isKindOfClass:[NSNumber class]] ||
                !vaultCacheValid([record[@"createdAt"] doubleValue], [record[@"expiresAt"] doubleValue],
                    [record[@"uptime"] doubleValue], stringValue(record[@"boot"]),
                    [record[@"expireOnRestart"] boolValue], NSDate.date.timeIntervalSince1970,
                    NSProcessInfo.processInfo.systemUptime, stringValue(bootSession()))) {
                SecItemDelete((__bridge CFDictionaryRef)query());
                fail(job, "CACHE_EXPIRED", "Touch ID has expired. Enter the master passphrase."); return;
            }
            NSData *output = [NSJSONSerialization dataWithJSONObject:record[@"passphrase"]
                                                           options:NSJSONWritingFragmentsAllowed error:nil];
            job->output.assign(static_cast<const char *>(output.bytes), output.length);
        } @catch (NSException *exception) {
            (void)exception;
            fail(job, "KEYCHAIN_ERROR", "The protected Keychain operation failed.");
        }
    }
}

static void complete(napi_env env, napi_status status, void *data) {
    Job *job = static_cast<Job *>(data);
    napi_value value;
    if (status != napi_ok && job->code.empty()) fail(job, "KEYCHAIN_ERROR", "The protected operation was cancelled.");
    if (job->code.empty()) {
        napi_create_string_utf8(env, job->output.data(), job->output.size(), &value);
        napi_resolve_deferred(env, job->deferred, value);
    } else {
        napi_value message, code;
        napi_create_string_utf8(env, job->message.c_str(), NAPI_AUTO_LENGTH, &message);
        napi_create_string_utf8(env, job->code.c_str(), NAPI_AUTO_LENGTH, &code);
        napi_create_error(env, code, message, &value);
        napi_reject_deferred(env, job->deferred, value);
    }
    // Best effort: N-API/V8 and Foundation can retain other copies until collection.
    std::fill(job->input.begin(), job->input.end(), '\0');
    std::fill(job->output.begin(), job->output.end(), '\0');
    napi_delete_async_work(env, job->work);
    delete job;
}

static bool getString(napi_env env, napi_value value, std::string &out, size_t max) {
    size_t size = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size > max) return false;
    out.resize(size + 1);
    napi_get_value_string_utf8(env, value, out.data(), size + 1, &size);
    out.resize(size);
    return true;
}

static napi_value request(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    Job *job = new Job{};
    job->env = env;
    if (argc < 2 || !getString(env, args[0], job->operation, 16) || !getString(env, args[1], job->input, 128 * 1024)) {
        delete job;
        napi_throw_type_error(env, nullptr, "Invalid protected vault request."); return nullptr;
    }
    // Diagnostic mode can ONLY forbid UI; it cannot authorize a read.
    if (argc > 2 && napi_get_value_bool(env, args[2], &job->noUI) != napi_ok) {
        delete job; napi_throw_type_error(env, nullptr, "Invalid no-UI option."); return nullptr;
    }
    napi_value promise, name;
    napi_create_promise(env, &job->deferred, &promise);
    napi_create_string_utf8(env, "Tabby protected vault", NAPI_AUTO_LENGTH, &name);
    napi_create_async_work(env, nullptr, name, execute, complete, job, &job->work);
    napi_queue_async_work(env, job->work);
    return promise;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, "request", NAPI_AUTO_LENGTH, request, nullptr, &fn);
    napi_set_named_property(env, exports, "request", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
