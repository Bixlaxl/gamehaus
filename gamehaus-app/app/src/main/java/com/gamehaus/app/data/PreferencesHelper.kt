package com.gamehaus.app.data

import android.content.Context
import android.content.SharedPreferences

class PreferencesHelper(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("gamehaus_prefs", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "https://gamehaus.railway.app") ?: "https://gamehaus.railway.app"
        set(value) = prefs.edit().putString("server_url", value).apply()

    var authToken: String?
        get() = prefs.getString("auth_token", null)
        set(value) = prefs.edit().putString("auth_token", value).apply()

    var refreshToken: String?
        get() = prefs.getString("refresh_token", null)
        set(value) = prefs.edit().putString("refresh_token", value).apply()

    var locationId: String?
        get() = prefs.getString("location_id", null)
        set(value) = prefs.edit().putString("location_id", value).apply()

    var staffEmail: String?
        get() = prefs.getString("staff_email", null)
        set(value) = prefs.edit().putString("staff_email", value).apply()

    var tableId: String?
        get() = prefs.getString("table_id", null)
        set(value) = prefs.edit().putString("table_id", value).apply()

    var tableName: String?
        get() = prefs.getString("table_name", null)
        set(value) = prefs.edit().putString("table_name", value).apply()

    var isPaired: Boolean
        get() = tableId != null
        set(value) {
            if (!value) {
                prefs.edit()
                    .remove("table_id")
                    .remove("table_name")
                    .remove("location_id")
                    .remove("staff_email")
                    .apply()
            }
        }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
