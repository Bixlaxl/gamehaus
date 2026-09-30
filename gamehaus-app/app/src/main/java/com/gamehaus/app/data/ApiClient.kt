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
    private var cleanAuthService: ApiService? = null

    private fun getCleanRetrofit(baseUrl: String): Retrofit {
        val cleanOkHttp = getUnsafeOkHttpClient()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(cleanOkHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun getService(): ApiService {
        val rawUrl = prefs.serverUrl.trim()
        val cleanUrl = rawUrl.removeSuffix("/").removeSuffix("/api").removeSuffix("/api/").trimEnd('/')
        val url = "$cleanUrl/"

        if (url != currentUrl || cachedService == null) {
            currentUrl = url
            cleanAuthService = getCleanRetrofit(url).create(ApiService::class.java)

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
                        // Prevent recursive loops if the auth endpoints themselves return 401
                        val path = response.request.url.encodedPath
                        if (path.contains("/api/tablet/refresh") || path.contains("/api/tablet/login")) {
                            return null
                        }

                        // Prevent infinite retry loops on stubborn 401s
                        if (responseCount(response) >= 3) {
                            return null
                        }

                        val currentFailedToken = prefs.authToken

                        // Synchronized block ensures only one refresh or re-login runs at a time
                        synchronized(this) {
                            // If another concurrent thread already updated the token, retry with it immediately
                            val latestToken = prefs.authToken
                            if (latestToken != null && latestToken != currentFailedToken) {
                                return response.request.newBuilder()
                                    .header("Authorization", "Bearer $latestToken")
                                    .build()
                            }

                            val authService = cleanAuthService ?: return null

                            // 1. First line of defense: Try silent refresh with refresh_token
                            val refreshToken = prefs.refreshToken
                            if (!refreshToken.isNullOrEmpty()) {
                                try {
                                    val refreshRes = authService.refreshToken(RefreshRequest(refreshToken)).execute()
                                    if (refreshRes.isSuccessful && refreshRes.body()?.success == true) {
                                        val newAuth = refreshRes.body()?.data?.token
                                        val newRefresh = refreshRes.body()?.data?.refresh_token

                                        if (newAuth != null) {
                                            prefs.authToken = newAuth
                                            if (newRefresh != null) {
                                                prefs.refreshToken = newRefresh
                                            }
                                            return response.request.newBuilder()
                                                .header("Authorization", "Bearer $newAuth")
                                                .build()
                                        }
                                    }
                                } catch (e: IOException) {
                                    // Network drop / offline. Keep credentials intact for when network returns.
                                    return null
                                } catch (e: Exception) {
                                    // Non-network error; fall through to auto-login
                                }
                            }

                            // 2. Second line of defense: Auto-relogin using saved staff credentials
                            // Guarantees the tablet never gets permanently stuck or requires staff PIN re-entry
                            val email = prefs.staffEmail
                            val pin = prefs.staffPin
                            if (!email.isNullOrEmpty() && !pin.isNullOrEmpty()) {
                                try {
                                    val loginRes = authService.loginSync(LoginRequest(email, pin)).execute()
                                    if (loginRes.isSuccessful && loginRes.body()?.success == true) {
                                        val data = loginRes.body()?.data
                                        val newAuth = data?.token
                                        val newRefresh = data?.refresh_token

                                        if (newAuth != null) {
                                            prefs.authToken = newAuth
                                            if (newRefresh != null) {
                                                prefs.refreshToken = newRefresh
                                            }
                                            if (data.user.location_id != null) {
                                                prefs.locationId = data.user.location_id
                                            }

                                            return response.request.newBuilder()
                                                .header("Authorization", "Bearer $newAuth")
                                                .build()
                                        }
                                    }
                                } catch (e: IOException) {
                                    // Network drop. Keep credentials intact.
                                    return null
                                } catch (e: Exception) {
                                    return null
                                }
                            }

                            return null
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

    private fun responseCount(response: Response): Int {
        var result = 1
        var prior = response.priorResponse
        while (prior != null) {
            result++
            prior = prior.priorResponse
        }
        return result
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
