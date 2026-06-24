package com.gamehaus.app.data

data class BaseResponse<T>(
    val success: Boolean,
    val data: T?,
    val error: String?
)

data class LoginRequest(
    val email: String,
    val password: String
)

data class LoginResponse(
    val token: String,
    val refresh_token: String? = null,
    val user: UserInfo
)

data class UserInfo(
    val id: String,
    val email: String,
    val role: String,
    val location_id: String?
)

data class LocationItem(
    val id: String,
    val name: String
)

data class TableItem(
    val id: String,
    val name: String,
    val type: String,
    val hourly_rate: Double,
    val people_pricing: Map<String, Double>?
)

data class TabletStatus(
    val table: TableItem,
    val session: SessionData?
)

data class SessionData(
    val order_item_id: String,
    val order_id: String,
    val status: String,
    val actual_start: String?,
    val expected_end: String?,
    val scheduled_start: String?,
    val scheduled_end: String?,
    val num_people: Int?,
    val rate_per_hour: Double,
    val elapsed_seconds: Long = 0L,
    val remaining_seconds: Long = 0L,
    val is_overtime: Boolean = false,
    val current_bill: Double,
    val extras: List<ExtraItem>
)

data class ExtraItem(
    val id: String,
    val name: String,
    val quantity: Int,
    val price: Double,
    val amount: Double
)

data class BeverageItem(
    val id: String,
    val name: String,
    val category: String,
    val selling_price: Double,
    val image_url: String?,
    val stock_count: Int
)

data class ExtendRequest(
    val order_item_id: String,
    val extend_mins: Int
)

data class PeopleRequest(
    val order_item_id: String,
    val num_people: Int
)

data class AddExtraRequest(
    val name: String,
    val price: Double,
    val quantity: Int,
    val inventory_item_id: String? = null
)
