package com.gamehaus.app.data

import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
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
                            // The refresh call itself got a 401 — this is a genuine revocation.
                            // Clear credentials so the app knows to unpair.
                            prefs.authToken = null
                            prefs.refreshToken = null
                            prefs.isPaired = false
                            return null
                        }

                        val currentFailedToken = prefs.authToken

                        // Synchronized block prevents multiple concurrent 401 responses
                        // (e.g. status poll + beverage fetch) from each calling refreshToken.
                        // Supabase rotates refresh tokens on first use, so a second call with
                        // the already-rotated token would fail and incorrectly unpair the tablet.
                        synchronized(this) {
                            // Double-check: if another thread already refreshed the token
                            // while we were waiting for the lock, just retry with the new token.
                            val latestToken = prefs.authToken
                            if (latestToken != null && latestToken != currentFailedToken) {
                                return response.request.newBuilder()
                                    .header("Authorization", "Bearer $latestToken")
                                    .build()
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
                                // Server explicitly rejected the refresh (non-IOException).
                                // This means the refresh token is truly expired/revoked — safe to unpair.
                                prefs.authToken = null
                                prefs.refreshToken = null
                                prefs.isPaired = false
                                return null
                            } catch (e: IOException) {
                                // Network error (timeout, Wi-Fi blip, tablet sleep/wake).
                                // Do NOT clear credentials — the token is still valid on the server.
                                // Return null so this individual request fails silently.
                                // The polling loop will retry in 5 seconds once connectivity returns.
                                return null
                            } catch (e: Exception) {
                                // Unknown error — treat conservatively like a network glitch:
                                // do not unpair, just fail this request silently.
                                return null
                            }
                        }
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
