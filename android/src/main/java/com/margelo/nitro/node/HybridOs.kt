package com.margelo.nitro.node

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules

@Keep
@DoNotStrip
class HybridOs: HybridNitroNodeOsSpec() {
    private val context
        get() = NitroModules.applicationContext
            ?: throw IllegalStateException("The React Native application context is not available yet")

    /** The app's cache directory, which Android also uses as java.io.tmpdir. */
    override fun tmpdir(): String = context.cacheDir.absolutePath

    /** The app's private data directory, e.g. /data/user/0/<package>. */
    override fun homedir(): String = context.applicationInfo.dataDir
}
