#pragma once

namespace margelo::nitro::node {

// Registers NitroNode's HybridObjects with Nitro's HybridObjectRegistry, as
// nitrogen's NitroNodeOnLoad does on Android. Defined in
// NitroNodeAutolinking.g.cpp, generated from nitro.json by
// scripts/generate-windows-autolinking.js.
void registerAllHybridObjects();

} // namespace margelo::nitro::node
