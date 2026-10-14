package com.margelo.nitro.node

import android.content.Context
import android.net.ConnectivityManager
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.ReactApplicationContext
import com.margelo.nitro.NitroModules
import com.margelo.nitro.node.HybridNitroNodeDnsInitSpec

@Keep
@DoNotStrip
class HybridDnsInit: HybridNitroNodeDnsInitSpec() {
    override fun init() {
        val ctx: ReactApplicationContext = NitroModules.applicationContext ?: return
        val connectivityManager: ConnectivityManager =
            (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?) ?: return
        caresInit(connectivityManager)
    }

    @Keep
    @Suppress("unused")
    external fun caresInit(cm: ConnectivityManager): Unit
}
