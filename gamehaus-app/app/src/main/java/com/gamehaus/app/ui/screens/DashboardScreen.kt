package com.gamehaus.app.ui.screens

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalConfiguration
import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.gamehaus.app.data.BeverageItem
import com.gamehaus.app.data.TableItem
import com.gamehaus.app.viewmodel.MainViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun DashboardScreen(
    viewModel: MainViewModel,
    modifier: Modifier = Modifier
) {
    val statusState by viewModel.status.collectAsState()
    val remainingTime by viewModel.remainingTimeStr.collectAsState()
    val remainingSeconds by viewModel.remainingSeconds.collectAsState()
    val beverages by viewModel.beverages.collectAsState()

    var showAdminDialog by remember { mutableStateOf(false) }
    var showExtendDialog by remember { mutableStateOf(false) }
    var showBeverageDialog by remember { mutableStateOf(false) }

    val status = statusState
    val isSessionActive = status?.session != null && status.session.status == "running"

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF111111))
    ) {
        if (status == null) {
            // Loading state
            Box(modifier = Modifier.fillMaxSize()) {
                IconButton(
                    onClick = { showAdminDialog = true },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Settings",
                        tint = Color.Gray
                    )
                }
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }
        } else if (!isSessionActive) {
            // IDLE SCREEN
            Box(modifier = Modifier.fillMaxSize()) {
                IconButton(
                    onClick = { showAdminDialog = true },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Settings",
                        tint = Color.Gray
                    )
                }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.SportsEsports,
                        contentDescription = null,
                        modifier = Modifier.size(100.dp),
                        tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f)
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Text(
                        text = status.table.name.uppercase(),
                        fontSize = 36.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Welcome to ${status.table.location_name ?: "Gamehaus"}!",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.Gray
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Please scan the QR code at the reception desk to start a session on this table.",
                        fontSize = 14.sp,
                        color = Color(0xFF888888),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(0.9f)
                    )
                }
            }
        } else {
            // ACTIVE HUD SCREEN
            val session = status.session!!
            val isTimeUp = remainingSeconds <= 0
            val bgColor = if (isTimeUp) Color(0xFFC61A1A) else Color(0xFFFF8A00)
            val fgColor = if (isTimeUp) Color.White else Color(0xFF111111)
            
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(bgColor)
                    .padding(32.dp)
            ) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    // Header Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (!session.customer_name.isNullOrEmpty()) {
                                Icon(Icons.Default.AccountCircle, contentDescription = null, tint = fgColor, modifier = Modifier.size(40.dp))
                                Spacer(modifier = Modifier.width(12.dp))
                                Text("Hello ${session.customer_name}", fontSize = 24.sp, fontWeight = FontWeight.Medium, color = fgColor)
                                Spacer(modifier = Modifier.width(20.dp))
                                Box(modifier = Modifier.width(2.dp).height(32.dp).background(fgColor.copy(alpha = 0.3f)))
                                Spacer(modifier = Modifier.width(20.dp))
                            }
                            Column {
                                Text(status.table.name.uppercase(), fontSize = 20.sp, fontWeight = FontWeight.Black, color = fgColor)
                                val playersTxt = if (session.num_people != null) "${session.num_people} PLAYERS" else "FLAT RATE"
                                val startTxt = "STARTED AT ${formatTime(session.actual_start)}"
                                Text("$playersTxt • $startTxt", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = fgColor.copy(alpha = 0.8f))
                            }
                        }
                        IconButton(onClick = { showAdminDialog = true }) {
                            Icon(Icons.Default.Settings, contentDescription = "Settings", tint = fgColor, modifier = Modifier.size(36.dp))
                        }
                    }

                    // Center Timer
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = if (isTimeUp) "TIME'S UP!" else "REMAINING TIME",
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold,
                            color = fgColor,
                            letterSpacing = 2.sp
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = remainingTime,
                            fontSize = 180.sp,
                            fontWeight = FontWeight.Black,
                            color = fgColor,
                            letterSpacing = (-4).sp,
                            modifier = Modifier.offset(y = (-10).dp)
                        )
                        
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                            modifier = Modifier
                                .clip(RoundedCornerShape(32.dp))
                                .background(if (isTimeUp) Color.Black.copy(alpha = 0.4f) else Color.Black.copy(alpha = 0.1f))
                                .padding(horizontal = 24.dp, vertical = 12.dp)
                        ) {
                            Icon(if (isTimeUp) Icons.Default.Warning else Icons.Default.Schedule, contentDescription = null, tint = fgColor, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            val endPrefix = if (isTimeUp) "TIME EXPIRED AT" else "ENDS AT"
                            Text("$endPrefix ${formatTime(session.expected_end)}", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = fgColor)
                        }
                        
                        if (isTimeUp) {
                            Spacer(modifier = Modifier.height(24.dp))
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Color.Black.copy(alpha = 0.3f))
                                    .padding(horizontal = 20.dp, vertical = 10.dp)
                            ) {
                                Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFFFB300), modifier = Modifier.size(20.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("If time crosses 5 minutes, you will be charged for 15 minutes.", fontSize = 16.sp, color = Color.White)
                            }
                        }
                    }

                    // Bottom Action Cards
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(20.dp)
                    ) {
                        ActionCard(
                            title = "ADD TIME",
                            subtitle = "Add more minutes",
                            icon = Icons.Default.MoreTime,
                            onClick = { showExtendDialog = true },
                            modifier = Modifier.weight(1f).height(140.dp)
                        )
                        ActionCard(
                            title = "ORDER FOOD & DRINKS",
                            subtitle = "View menu",
                            icon = Icons.Default.Fastfood,
                            onClick = { showBeverageDialog = true },
                            modifier = Modifier.weight(1f).height(140.dp)
                        )
                        ActionCard(
                            title = "AMOUNT DUE",
                            subtitle = "Includes ₹${String.format(Locale.US, "%.2f", session.extras.sumOf { it.amount })} (Extras)",
                            value = "₹${String.format(Locale.US, "%.2f", session.current_bill)}",
                            icon = null,
                            onClick = { /* Details */ },
                            modifier = Modifier.weight(1f).height(140.dp)
                        )
                    }
                }
            }
        }

        // ── DIALOGS ──

        // 1. Extend Session Dialog
        if (showExtendDialog && isSessionActive) {
            ExtendDialog(
                viewModel = viewModel,
                maxExtendMins = status!!.session!!.max_extend_mins,
                onDismiss = { showExtendDialog = false }
            )
        }

        // 2. Beverages Order Dialog
        if (showBeverageDialog && isSessionActive) {
            BeverageOrderDialog(
                viewModel = viewModel,
                items = beverages,
                onDismiss = { showBeverageDialog = false }
            )
        }

        // 3. Admin Settings Dialog
        if (showAdminDialog) {
            AdminDialog(
                viewModel = viewModel,
                onDismiss = { showAdminDialog = false }
            )
        }
    }
}

@Composable
fun ActionCard(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier
            .height(100.dp)
            .clickable(enabled = enabled) { onClick() },
        colors = CardDefaults.cardColors(
            containerColor = if (enabled) Color(0xFF1E1E1E) else Color(0xFF161616)
        ),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, Color(0xFF2C2C2C).copy(alpha = if (enabled) 1f else 0.5f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.Center
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = if (enabled) MaterialTheme.colorScheme.primary else Color.DarkGray,
                    modifier = Modifier.size(24.dp)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = if (enabled) Color.White else Color.DarkGray
            )
            Text(
                text = subtitle,
                fontSize = 11.sp,
                color = if (enabled) Color.Gray else Color.DarkGray.copy(alpha = 0.5f)
            )
        }
    }
}

// ── Extend Time Dialog ──
@Composable
fun ExtendDialog(
    viewModel: MainViewModel,
    maxExtendMins: Int,
    onDismiss: () -> Unit
) {
    val allPresets = listOf(15, 30, 45, 60, 90, 120)
    // Only show presets that fit within the available window
    val availablePresets = allPresets.filter { it <= maxExtendMins }
    val blockedByNext = maxExtendMins <= 0

    // Default selection: largest available preset, or smallest if none fit
    var selectedPreset by remember {
        mutableStateOf(
            if (availablePresets.isNotEmpty()) availablePresets.last() else allPresets.first()
        )
    }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            modifier = Modifier
                .widthIn(max = 400.dp)
                .fillMaxWidth(0.9f)
                .padding(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1E1E)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Extend Session", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)

                if (blockedByNext) {
                    // Fully blocked — next booking starts immediately
                    Text(
                        text = "Extension not available — the next booking starts imminently.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                } else {
                    Text(
                        text = if (maxExtendMins < 120)
                            "Up to $maxExtendMins min available (next booking or closing time):"
                        else
                            "Choose how many minutes to add:",
                        fontSize = 13.sp,
                        color = Color.Gray
                    )

                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(100.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(allPresets) { mins ->
                            val isAvailable = mins <= maxExtendMins
                            val active = selectedPreset == mins && isAvailable
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(44.dp)
                                    .clickable(enabled = isAvailable && !isSubmitting) {
                                        selectedPreset = mins
                                    },
                                colors = CardDefaults.cardColors(
                                    containerColor = when {
                                        active       -> MaterialTheme.colorScheme.primary
                                        !isAvailable -> Color(0xFF1A1A1A)
                                        else         -> Color(0xFF2A2A2A)
                                    }
                                ),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text(
                                        text = "+${mins}m",
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = when {
                                            active       -> Color.White
                                            !isAvailable -> Color(0xFF444444)
                                            else         -> Color(0xFFCCCCCC)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }

                if (errorMsg != null) {
                    Text(errorMsg!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        enabled = !isSubmitting,
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                    ) {
                        Text("Cancel", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                    }

                    Button(
                        onClick = {
                            if (isSubmitting || blockedByNext) return@Button
                            isSubmitting = true
                            errorMsg = null
                            viewModel.extendSession(
                                minutes = selectedPreset,
                                onSuccess = onDismiss,
                                onError = {
                                    isSubmitting = false
                                    errorMsg = it
                                }
                            )
                        },
                        enabled = !isSubmitting && !blockedByNext && availablePresets.isNotEmpty(),
                        modifier = Modifier.weight(1.2f),
                        contentPadding = PaddingValues(horizontal = 8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            Text("Confirm", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}


// ── Beverages order Dialog ──
@Composable
fun BeverageOrderDialog(
    viewModel: MainViewModel,
    items: List<BeverageItem>,
    onDismiss: () -> Unit
) {
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var selectedItem by remember { mutableStateOf<BeverageItem?>(null) }
    var quantity by remember { mutableStateOf(1) }
    var isSubmitting by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            modifier = Modifier
                .widthIn(max = 550.dp)
                .fillMaxWidth(0.92f)
                .fillMaxHeight(0.8f)
                .padding(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1E1E)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Order Beverages & Snacks", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)

                if (selectedItem == null) {
                    val configuration = LocalConfiguration.current
                    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                    val isTablet = configuration.screenWidthDp >= 600
                    val columns = if (isTablet || isLandscape) 2 else 1

                    // Display Catalog list
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(columns),
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(items, key = { it.id }) { drink ->
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { selectedItem = drink },
                                colors = CardDefaults.cardColors(containerColor = Color(0xFF2A2A2A)),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    AsyncImage(
                                        model = drink.image_url,
                                        contentDescription = drink.name,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .size(50.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = drink.name,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Color.White,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = "₹${drink.selling_price}",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.primary,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = "Stock: ${drink.stock_count}",
                                            fontSize = 10.sp,
                                            color = Color.Gray,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }
                    }
                    Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                        Text("Close")
                    }
                } else {
                    // Confirm Order item & quantity selection
                    val drink = selectedItem!!
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        AsyncImage(
                            model = drink.image_url,
                            contentDescription = drink.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(120.dp)
                                .clip(RoundedCornerShape(12.dp))
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(drink.name, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        Text("₹${drink.selling_price} each", fontSize = 14.sp, color = MaterialTheme.colorScheme.primary)

                        Spacer(modifier = Modifier.height(24.dp))

                        // Quantity Selector
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            FilledIconButton(
                                onClick = { if (quantity > 1 && !isSubmitting) quantity-- },
                                enabled = !isSubmitting,
                                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFF2A2A2A))
                            ) {
                                Icon(Icons.Default.Remove, contentDescription = "Decrease", tint = Color.White)
                            }
                            Text(quantity.toString(), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            FilledIconButton(
                                onClick = { if (quantity < drink.stock_count && !isSubmitting) quantity++ },
                                enabled = !isSubmitting,
                                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFF2A2A2A))
                            ) {
                                Icon(Icons.Default.Add, contentDescription = "Increase", tint = Color.White)
                            }
                        }
                    }

                    if (errorMsg != null) {
                        Text(errorMsg!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = { selectedItem = null },
                            enabled = !isSubmitting,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(horizontal = 8.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                        ) {
                            Text("Back", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                        }

                        Button(
                            onClick = {
                                if (isSubmitting) return@Button
                                isSubmitting = true
                                errorMsg = null
                                viewModel.orderBeverage(
                                    item = drink,
                                    quantity = quantity,
                                    onSuccess = {
                                        isSubmitting = false
                                        selectedItem = null
                                        quantity = 1
                                        onDismiss()
                                    },
                                    onError = {
                                        isSubmitting = false
                                        errorMsg = it
                                    }
                                )
                            },
                            enabled = !isSubmitting,
                            modifier = Modifier.weight(1.2f),
                            contentPadding = PaddingValues(horizontal = 8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            if (isSubmitting) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                            } else {
                                Text("Place Order", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Admin Settings/Unpair Dialog ──
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDialog(
    viewModel: MainViewModel,
    onDismiss: () -> Unit
) {
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var isAuthenticated by remember { mutableStateOf(false) }
    val isLoading by viewModel.isLoading.collectAsState()

    val tables by viewModel.pairingTables.collectAsState()
    var selectedTable by remember { mutableStateOf<TableItem?>(null) }
    var dropdownExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) {
            viewModel.fetchTablesForLocation(
                onSuccess = {
                    val currentId = viewModel.prefs.tableId
                    selectedTable = tables.find { it.id == currentId }
                },
                onError = { errorMsg = it }
            )
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth(0.92f).padding(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1E1E)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Kiosk Administration", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)

                if (!isAuthenticated) {
                    Text("Enter the staff password to edit table assignment or unpair this tablet:", fontSize = 13.sp, color = Color.Gray)

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
                        singleLine = true,
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            val icon = if (passwordVisible) Icons.Filled.Visibility else Icons.Filled.VisibilityOff
                            val desc = if (passwordVisible) "Hide password" else "Show password"
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(imageVector = icon, contentDescription = desc, tint = Color.Gray)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MaterialTheme.colorScheme.primary,
                            unfocusedBorderColor = Color(0xFF333333),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )

                    if (errorMsg != null) {
                        Text(errorMsg!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = onDismiss,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(horizontal = 8.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                        ) {
                            Text("Cancel", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                        }

                        Button(
                            onClick = {
                                if (password.isNotBlank()) {
                                    viewModel.validateAdminPassword(
                                        password = password,
                                        onSuccess = {
                                            isAuthenticated = true
                                            errorMsg = null
                                        },
                                        onError = { errorMsg = it }
                                    )
                                } else {
                                    errorMsg = "Password required"
                                }
                            },
                            enabled = !isLoading,
                            modifier = Modifier.weight(1.2f),
                            contentPadding = PaddingValues(horizontal = 8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                            } else {
                                Text("Verify PIN", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                            }
                        }
                    }
                } else {
                    Text("Manage table pairing for this kiosk device:", fontSize = 13.sp, color = Color.Gray)

                    Text(
                        text = "Currently paired with: ${viewModel.prefs.tableName ?: "Unknown"}",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )

                    ExposedDropdownMenuBox(
                        expanded = dropdownExpanded,
                        onExpandedChange = { dropdownExpanded = it },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        OutlinedTextField(
                            value = selectedTable?.name ?: "Select Table...",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Assign to Table") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded) },
                            modifier = Modifier.menuAnchor().fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = MaterialTheme.colorScheme.primary,
                                unfocusedBorderColor = Color(0xFF333333),
                                focusedLabelColor = MaterialTheme.colorScheme.primary,
                                unfocusedLabelColor = Color.Gray,
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White
                            )
                        )

                        ExposedDropdownMenu(
                            expanded = dropdownExpanded,
                            onDismissRequest = { dropdownExpanded = false },
                            modifier = Modifier.background(Color(0xFF1E1E1E))
                        ) {
                            tables.forEach { table ->
                                DropdownMenuItem(
                                    text = { Text(table.name, color = Color.White) },
                                    onClick = {
                                        selectedTable = table
                                        dropdownExpanded = false
                                    }
                                )
                            }
                            if (tables.isEmpty() && !isLoading) {
                                DropdownMenuItem(
                                    text = { Text("No active tables found", color = Color.Gray) },
                                    onClick = {},
                                    enabled = false
                                )
                            }
                        }
                    }

                    if (errorMsg != null) {
                        Text(errorMsg!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }

                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            OutlinedButton(
                                onClick = onDismiss,
                                modifier = Modifier.weight(1f),
                                contentPadding = PaddingValues(horizontal = 8.dp),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                            ) {
                                Text("Close", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                            }

                            Button(
                                onClick = {
                                    val table = selectedTable
                                    if (table != null) {
                                        viewModel.updateTableAssignment(table)
                                        onDismiss()
                                    } else {
                                        errorMsg = "Please select a table"
                                    }
                                },
                                enabled = selectedTable != null && !isLoading,
                                modifier = Modifier.weight(1.2f),
                                contentPadding = PaddingValues(horizontal = 8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                            ) {
                                Text("Save & Switch", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                            }
                        }

                        Divider(color = Color(0xFF2C2C2C), thickness = 1.dp, modifier = Modifier.padding(vertical = 4.dp))

                        Button(
                            onClick = {
                                viewModel.unpair()
                                onDismiss()
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626))
                        ) {
                            Text("Unpair & Logout Kiosk", fontWeight = FontWeight.Bold, color = Color.White)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ActionCard(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector?,
    value: String? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = Color(0xFF111111)),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = Color(0xFFFF8A00), modifier = Modifier.size(36.dp))
                Spacer(modifier = Modifier.height(12.dp))
            } else if (value != null) {
                Text(
                    text = title,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = value,
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Black,
                    color = Color(0xFFFF8A00)
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = subtitle,
                    fontSize = 12.sp,
                    color = Color.Gray
                )
                return@Column
            }
            
            Text(
                text = title,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                letterSpacing = 1.sp
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = subtitle,
                fontSize = 12.sp,
                color = Color.Gray
            )
        }
    }
}

private fun formatTime(isoStr: String?): String {
    if (isoStr.isNullOrEmpty()) return "—"
    return try {
        val sdfIn = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
        sdfIn.timeZone = TimeZone.getTimeZone("UTC")
        val date = sdfIn.parse(isoStr) ?: return "—"
        val sdfOut = SimpleDateFormat("h:mm a", Locale.getDefault())
        sdfOut.format(date)
    } catch (e: Exception) {
        "—"
    }
}
