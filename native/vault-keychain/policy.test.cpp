#include "policy.h"
#include <cassert>
#include <limits>

int main() {
    assert(vaultCacheValid(1000, 2000, 100, "a", false, 1100, 200, "a"));
    assert(!vaultCacheValid(1000, 2000, 100, "a", false, 2000, 200, "a"));
    assert(!vaultCacheValid(1000, 2000, 100, "a", false, 900, 200, "a"));
    assert(!vaultCacheValid(1000, 2000, 100, "a", false, 1100, 1200, "a"));
    assert(!vaultCacheValid(1000, 2000, 100, "a", true, 1100, 10, "b"));
    assert(vaultCacheValid(1000, 2000, 100, "a", false, 1100, 10, "b"));
    assert(!vaultCacheValid(1000, 1000 + 31 * 86400, 100, "a", false, 1100, 200, "a"));
    assert(!vaultCacheValid(1000, 2000, 100, "", false, 1100, 200, "a"));
    assert(!vaultCacheValid(1000, std::numeric_limits<double>::quiet_NaN(), 100, "a", false, 1100, 200, "a"));
}
