#pragma once
#include <cmath>
#include <string>

// Evaluated inside the native Keychain reader, never from renderer timestamps.
inline bool vaultCacheValid(double created, double expires, double storedUptime,
                            const std::string& boot, bool expireOnRestart,
                            double now, double uptime, const std::string& currentBoot) {
    if (!std::isfinite(created) || !std::isfinite(expires) ||
        !std::isfinite(storedUptime) || !std::isfinite(now) || !std::isfinite(uptime) ||
        boot.empty() || currentBoot.empty() || created > now || expires <= now ||
        expires <= created || expires - created > 30 * 86400 || storedUptime < 0) {
        return false;
    }
    if (boot != currentBoot) {
        return !expireOnRestart;
    }
    // A wall-clock rollback must not extend the cache within a boot session.
    return uptime >= storedUptime && uptime - storedUptime < expires - created;
}
