package com.gamehaus.app.data

import retrofit2.Call
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {
    @POST("api/tablet/login")
    suspend fun login(@Body request: LoginRequest): BaseResponse<LoginResponse>

    @POST("api/tablet/refresh")
    fun refreshToken(@Body request: RefreshRequest): Call<BaseResponse<LoginResponse>>

    @GET("api/tables")
    suspend fun getTables(@Query("location_id") locationId: String): BaseResponse<List<TableItem>>

    @GET("api/tablet/status")
    suspend fun getStatus(@Query("table_id") tableId: String): BaseResponse<TabletStatus>

    @GET("api/tablet/beverages")
    suspend fun getBeverages(@Query("location_id") locationId: String): BaseResponse<List<BeverageItem>>

    @POST("api/sessions/extend")
    suspend fun extendSession(@Body request: ExtendRequest): BaseResponse<Map<String, Any>>

    @POST("api/orders/{id}/extras")
    suspend fun addExtra(
        @Path("id") orderId: String,
        @Body request: AddExtraRequest
    ): BaseResponse<ExtraItem>

}
