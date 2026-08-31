package com.gamehaus.app.data

import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class ApiClient(private val prefs: PreferencesHelper) {

    private var currentUrl: String? = null
    private var cachedService: ApiService? = null

    fun getService(): ApiService {
        val rawUrl = prefs.serverUrl.trim()
        val cleanUrl = rawUrl.removeSuffix("/").removeSuffix("/api").removeSuffix("/api/").trimEnd('/')
        val url = "$cleanUrl/"

        if (url != currentUrl || cachedService == null) {
            currentUrl = url

            val okHttpClient = getUnsafeOkHttpClient()
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
                .authenticator(object : Authenticator {
                    override fun authenticate(route: Route?, response: Response): Request? {
                        // Prevent infinite loop if the refresh endpoint itself returns 401
                        if (response.request.url.encodedPath.contains("/api/tablet/refresh")) {
                            return null
                        }

                        val refreshToken = prefs.refreshToken ?: return null
                        val service = cachedService ?: return null

                        try {
                            val refreshResponse = service.refreshToken(RefreshRequest(refreshToken)).execute()
                            if (refreshResponse.isSuccessful && refreshResponse.body()?.success == true) {
                                val newAuthToken = refreshResponse.body()?.data?.token
                                val newRefreshToken = refreshResponse.body()?.data?.refresh_token

                                if (newAuthToken != null) {
                                    prefs.authToken = newAuthToken
                                    if (newRefreshToken != null) {
                                        prefs.refreshToken = newRefreshToken
                                    }
                                    
                                    return response.request.newBuilder()
                                        .header("Authorization", "Bearer $newAuthToken")
                                        .build()
                                }
                            }
                        } catch (e: Exception) {
                            // ignore, let it fail
                        }

                        // Refresh failed, clear tokens so app unpairs
                        prefs.authToken = null
                        prefs.refreshToken = null
                        prefs.isPaired = false
                        return null
                    }
                })
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

    // Helper to trust all certificates for older Android tablets
    private fun getUnsafeOkHttpClient(): OkHttpClient.Builder {
        try {
            val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            })

            val sslContext = SSLContext.getInstance("SSL")
            sslContext.init(null, trustAllCerts, SecureRandom())
            val sslSocketFactory = sslContext.socketFactory

            val builder = OkHttpClient.Builder()
            builder.sslSocketFactory(sslSocketFactory, trustAllCerts[0] as X509TrustManager)
            builder.hostnameVerifier { _, _ -> true }
            return builder
        } catch (e: Exception) {
            throw RuntimeException(e)
        }
    }
}
