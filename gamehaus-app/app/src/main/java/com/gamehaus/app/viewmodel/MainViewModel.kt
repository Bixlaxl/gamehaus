package com.gamehaus.app.viewmodel

import android.app.Application
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.gamehaus.app.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.*

class MainViewModel(application: Application) : AndroidViewModel(application) {
    val prefs = PreferencesHelper(application)
    val client = ApiClient(prefs)

    private val _isPaired = MutableStateFlow(prefs.isPaired)
    val isPaired: StateFlow<Boolean> = _isPaired.asStateFlow()

    private val _status = MutableStateFlow<TabletStatus?>(null)
    val status: StateFlow<TabletStatus?> = _status.asStateFlow()

    private val _beverages = MutableStateFlow<List<BeverageItem>>(emptyList())
    val beverages: StateFlow<List<BeverageItem>> = _beverages.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _pairingTables = MutableStateFlow<List<TableItem>>(emptyList())
    val pairingTables: StateFlow<List<TableItem>> = _pairingTables.asStateFlow()

    // Realtime ticking states
    private val _remainingTimeStr = MutableStateFlow("00:00:00")
    val remainingTimeStr: StateFlow<String> = _remainingTimeStr.asStateFlow()

    private val _remainingSeconds = MutableStateFlow(0L)
    val remainingSeconds: StateFlow<Long> = _remainingSeconds.asStateFlow()

    private var pollJob: Job? = null
    private var timerJob: Job? = null
    private val toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
    private var hasBeepedThisSession = false

    init {
        if (prefs.isPaired) {
            startActiveSessionFlow()
        }
    }

    fun setServerUrl(url: String) {
        prefs.serverUrl = url
    }

    fun authenticateStaff(email: String, pin: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            try {
                val service = client.getService()
                val loginRes = service.login(LoginRequest(email, pin))
                if (loginRes.success && loginRes.data != null) {
                    prefs.authToken = loginRes.data.token
                    prefs.refreshToken = loginRes.data.refresh_token
                    prefs.locationId = loginRes.data.user.location_id
                    prefs.staffEmail = email

                    // Fetch tables list for this location
                    val tablesRes = service.getTables(loginRes.data.user.location_id ?: "")
                    if (tablesRes.success && tablesRes.data != null) {
                        _pairingTables.value = tablesRes.data
                        onSuccess()
                    } else {
                        _errorMessage.value = tablesRes.error ?: "Failed to fetch tables"
                    }
                } else {
                    _errorMessage.value = loginRes.error ?: "Invalid credentials"
                }
            } catch (e: Exception) {
                _errorMessage.value = getErrorMessage(e)
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun validateAdminPassword(password: String, onSuccess: () -> Unit, onError: (String) -> Unit) {
        val email = prefs.staffEmail
        if (email.isNullOrEmpty()) {
            onError("No authenticated staff member found")
            return
        }
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val service = client.getService()
                val loginRes = service.login(LoginRequest(email, password))
                if (loginRes.success && loginRes.data != null) {
                    prefs.authToken = loginRes.data.token
                    prefs.refreshToken = loginRes.data.refresh_token
                    onSuccess()
                } else {
                    onError(loginRes.error ?: "Invalid password")
                }
            } catch (e: Exception) {
                onError(getErrorMessage(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun fetchTablesForLocation(onSuccess: () -> Unit = {}, onError: (String) -> Unit = {}) {
        val locationId = prefs.locationId
        if (locationId.isNullOrEmpty()) {
            onError("No location ID found")
            return
        }
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val service = client.getService()
                val tablesRes = service.getTables(locationId)
                if (tablesRes.success && tablesRes.data != null) {
                    _pairingTables.value = tablesRes.data
                    onSuccess()
                } else {
                    onError(tablesRes.error ?: "Failed to fetch tables")
                }
            } catch (e: Exception) {
                onError(getErrorMessage(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun updateTableAssignment(table: TableItem) {
        prefs.tableId = table.id
        prefs.tableName = table.name
        startActiveSessionFlow()
    }

    fun completePairing(table: TableItem) {
        prefs.tableId = table.id
        prefs.tableName = table.name
        _isPaired.value = true
        startActiveSessionFlow()
    }

    fun unpair() {
        pollJob?.cancel()
        timerJob?.cancel()
        prefs.isPaired = false
        prefs.authToken = null
        prefs.refreshToken = null
        _status.value = null
        _isPaired.value = false
    }

    fun startActiveSessionFlow() {
        pollJob?.cancel()
        timerJob?.cancel()
        hasBeepedThisSession = false

        val tableId = prefs.tableId ?: return
        val locationId = prefs.locationId ?: return

        // Fetch beverages list once on start
        fetchBeverages()

        // Poll status every 5 seconds
        pollJob = viewModelScope.launch {
            while (isActive) {
                try {
                    val res = client.getService().getStatus(tableId)
                    if (res.success && res.data != null) {
                        val oldSession = _status.value?.session
                        if (_status.value != res.data) {
                            _status.value = res.data
                        }

                        // Reset beep flag if new session started
                        if (res.data.session?.order_item_id != oldSession?.order_item_id) {
                            hasBeepedThisSession = false
                        }
                    }
                } catch (e: Exception) {
                    // silent retry
                }

                delay(5000)
            }
        }

        // Timer countdown tick every second
        timerJob = viewModelScope.launch {
            while (isActive) {
                val session = _status.value?.session
                if (session != null && session.status == "running" && session.expected_end != null) {
                    val endMs = parseIsoDate(session.expected_end)
                    val nowMs = System.currentTimeMillis()
                    val remSecs = Math.max(0L, (endMs - nowMs) / 1000L)

                    _remainingSeconds.value = remSecs
                    _remainingTimeStr.value = formatSeconds(remSecs)

                    // Beep alert exactly 5 minutes (300 seconds) before end
                    if (remSecs in 299..301 && !hasBeepedThisSession) {
                        playBeep()
                        hasBeepedThisSession = true
                    }
                } else {
                    _remainingSeconds.value = 0L
                    _remainingTimeStr.value = "00:00:00"
                }
                delay(1000)
            }
        }
    }

    fun extendSession(minutes: Int, onSuccess: () -> Unit, onError: (String) -> Unit) {
        val session = _status.value?.session ?: return
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val res = client.getService().extendSession(ExtendRequest(session.order_item_id, minutes))
                if (res.success) {
                    refreshStatus()
                    onSuccess()
                } else {
                    onError(res.error ?: "Cannot extend session")
                }
            } catch (e: Exception) {
                onError(getErrorMessage(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun changePlayerCount(count: Int, onSuccess: () -> Unit, onError: (String) -> Unit) {
        val session = _status.value?.session ?: return
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val res = client.getService().changePeople(PeopleRequest(session.order_item_id, count))
                if (res.success) {
                    refreshStatus()
                    onSuccess()
                } else {
                    onError(res.error ?: "Cannot change player count")
                }
            } catch (e: Exception) {
                onError(getErrorMessage(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun orderBeverage(item: BeverageItem, quantity: Int, onSuccess: () -> Unit, onError: (String) -> Unit) {
        val session = _status.value?.session ?: return
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val res = client.getService().addExtra(
                    orderId = session.order_id,
                    request = AddExtraRequest(
                        name = item.name,
                        price = item.selling_price,
                        quantity = quantity,
                        inventory_item_id = item.id
                    )
                )
                if (res.success) {
                    refreshStatus()
                    fetchBeverages()
                    onSuccess()
                } else {
                    onError(res.error ?: "Failed to order item")
                }
            } catch (e: Exception) {
                onError(getErrorMessage(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun stopSession(onSuccess: () -> Unit, onError: (String) -> Unit) {
        val session = _status.value?.session ?: return
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val res = client.getService().stopSession(mapOf("order_item_id" to session.order_item_id))
                if (res.success) {
                    refreshStatus()
                    onSuccess()
                } else {
                    onError(res.error ?: "Failed to stop session")
                }
            } catch (e: Exception) {
                onError(getErrorMessage(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    private suspend fun refreshStatus() {
        val tableId = prefs.tableId ?: return
        try {
            val res = client.getService().getStatus(tableId)
            if (res.success && res.data != null) {
                _status.value = res.data
            }
        } catch (e: Exception) {
            // ignore
        }
    }

    fun fetchBeverages() {
        val locationId = prefs.locationId ?: return
        viewModelScope.launch {
            try {
                val res = client.getService().getBeverages(locationId)
                if (res.success && res.data != null) {
                    _beverages.value = res.data
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    private fun playBeep() {
        try {
            toneGenerator.startTone(ToneGenerator.TONE_CDMA_PIP, 400)
        } catch (e: Exception) {
            // ignore
        }
    }

    private fun parseIsoDate(iso: String): Long {
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            sdf.parse(iso)?.time ?: 0L
        } catch (e: Exception) {
            0L
        }
    }

    private fun formatSeconds(totalSeconds: Long): String {
        val h = totalSeconds / 3600
        val m = (totalSeconds % 3600) / 60
        val s = totalSeconds % 60
        return String.format(Locale.US, "%02d:%02d:%02d", h, m, s)
    }

    private fun getErrorMessage(e: Throwable): String {
        if (e is retrofit2.HttpException) {
            try {
                val errorBody = e.response()?.errorBody()?.string()
                val parsedError = com.google.gson.Gson().fromJson<BaseResponse<Any>>(
                    errorBody,
                    object : com.google.gson.reflect.TypeToken<BaseResponse<Any>>() {}.type
                )
                return parsedError?.error ?: "HTTP ${e.code()}: ${e.message()}"
            } catch (ex: Exception) {
                return "HTTP ${e.code()}: ${e.message()}"
            }
        }
        return e.message ?: "An unexpected error occurred"
    }

    override fun onCleared() {
        super.onCleared()
        pollJob?.cancel()
        timerJob?.cancel()
        toneGenerator.release()
    }
}
