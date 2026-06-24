package com.gamehaus.app.data

import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class ApiClient(private val prefs: PreferencesHelper) {

    private var currentUrl: String? = null
    private var cachedService: ApiService? = null

    fun getService(): ApiService {
        val rawUrl = prefs.serverUrl.trim()
        val url = if (rawUrl.endsWith("/")) rawUrl else "$rawUrl/"

        if (url != currentUrl || cachedService == null) {
            currentUrl = url

            val okHttpClient = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    val original = chain.request()
                    val requestBuilder = original.newBuilder()

                    // Add authorization header if available
                    prefs.authToken?.let { token ->
                        requestBuilder.addHeader("Authorization", "Bearer $token")
                    }

                    chain.proceed(requestBuilder.build())
                }
                .build()

            val retrofit = Retrofit.Builder()
                .baseUrl(url)
                .client(okHttpClient)
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            cachedService = retrofit.create(ApiService::class.java)
        }

        return cachedService!!
    }
}
