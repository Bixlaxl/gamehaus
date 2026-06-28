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
    var showPlayerDialog by remember { mutableStateOf(false) }
    var showBeverageDialog by remember { mutableStateOf(false) }
    var showStopDialog by remember { mutableStateOf(false) }

    val status = statusState
    val isSessionActive = status?.session != null && status.session.status == "running"

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF111111))
    ) {
        if (status == null) {
            // Loading state
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
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
                        text = "Welcome to Gamehaus!",
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

            val configuration = LocalConfiguration.current
            val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
            ) {
                // Header (Table name & Settings cog)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = status.table.name,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Black,
                            color = Color.White
                        )
                        Text(
                            text = if (session.num_people != null) {
                                "${session.num_people} " + if (status.table.type == "ps5") "controllers active" else "players active"
                            } else "Flat table rate",
                            fontSize = 12.sp,
                            color = Color.Gray
                        )
                    }

                    IconButton(onClick = { showAdminDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Settings",
                            tint = Color.Gray
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                if (isLandscape) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(20.dp)
                    ) {
                        CountdownCard(
                            remainingSeconds = remainingSeconds,
                            remainingTime = remainingTime,
                            session = session,
                            modifier = Modifier
                                .weight(1.2f)
                                .fillMaxHeight()
                        )

                        BillAndActions(
                            status = status,
                            session = session,
                            onExtendClick = { showExtendDialog = true },
                            onBeverageClick = { showBeverageDialog = true },
                            onPlayerClick = { showPlayerDialog = true },
                            onStopClick = { showStopDialog = true },
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight()
                        )
                    }
                } else {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        CountdownCard(
                            remainingSeconds = remainingSeconds,
                            remainingTime = remainingTime,
                            session = session,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(220.dp)
                        )

                        BillAndActions(
                            status = status,
                            session = session,
                            onExtendClick = { showExtendDialog = true },
                            onBeverageClick = { showBeverageDialog = true },
                            onPlayerClick = { showPlayerDialog = true },
                            onStopClick = { showStopDialog = true },
                            modifier = Modifier.fillMaxWidth()
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
                onDismiss = { showExtendDialog = false }
            )
        }

        // 2. Adjust Players Dialog
        if (showPlayerDialog && isSessionActive) {
            val session = status!!.session!!
            PlayerCountDialog(
                viewModel = viewModel,
                table = status.table,
                currentCount = session.num_people ?: 1,
                onDismiss = { showPlayerDialog = false }
            )
        }

        // 3. Beverages Order Dialog
        if (showBeverageDialog && isSessionActive) {
            BeverageOrderDialog(
                viewModel = viewModel,
                items = beverages,
                onDismiss = { showBeverageDialog = false }
            )
        }

        // 4. Stop Confirmation Dialog
        if (showStopDialog && isSessionActive) {
            ConfirmStopDialog(
                viewModel = viewModel,
                onDismiss = { showStopDialog = false }
            )
        }

        // 5. Admin Settings Dialog
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
    onDismiss: () -> Unit
) {
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var selectedPreset by remember { mutableStateOf(30) }
    var isSubmitting by remember { mutableStateOf(false) }
    val presets = listOf(15, 30, 45, 60, 90, 120)

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
                Text("Choose how many minutes you want to add to your current session:", fontSize = 13.sp, color = Color.Gray)

                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(100.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(presets) { mins ->
                        val active = selectedPreset == mins
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(44.dp)
                                .clickable(enabled = !isSubmitting) { selectedPreset = mins },
                            colors = CardDefaults.cardColors(
                                containerColor = if (active) MaterialTheme.colorScheme.primary else Color(0xFF2A2A2A)
                            ),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text(
                                    text = "+${mins}m",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (active) Color.White else Color(0xFFCCCCCC)
                                )
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
                            if (isSubmitting) return@Button
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
                        enabled = !isSubmitting,
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

// ── Change Player Count Dialog ──
@Composable
fun PlayerCountDialog(
    viewModel: MainViewModel,
    table: com.gamehaus.app.data.TableItem,
    currentCount: Int,
    onDismiss: () -> Unit
) {
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }
    val pricing = table.people_pricing ?: emptyMap()
    val options = pricing.keys.mapNotNull { it.toIntOrNull() }.sorted()
    var selectedCount by remember { mutableStateOf(currentCount) }

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
                val label = if (table.type == "ps5") "Controllers" else "Players"
                Text("Select $label", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    options.forEachIndexed { idx, opt ->
                        // Match range display format (lowest option is range e.g. 1-4)
                        val displayStr = if (idx == 0 && opt > 1) "1-$opt" else opt.toString()
                        val active = if (idx == 0 && opt > 1) selectedCount <= opt else selectedCount == opt

                        Card(
                            modifier = Modifier
                                .weight(1f)
                                .height(50.dp)
                                .clickable(enabled = !isSubmitting) { selectedCount = opt },
                            colors = CardDefaults.cardColors(
                                containerColor = if (active) MaterialTheme.colorScheme.primary else Color(0xFF2A2A2A)
                            ),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text(
                                    text = displayStr,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
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
                            if (isSubmitting) return@Button
                            isSubmitting = true
                            errorMsg = null
                            viewModel.changePlayerCount(
                                count = selectedCount,
                                onSuccess = onDismiss,
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
                            Text("Update", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
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

// ── Stop Session Dialog ──
@Composable
fun ConfirmStopDialog(
    viewModel: MainViewModel,
    onDismiss: () -> Unit
) {
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth(0.9f),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1E1E)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Finish Session?", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("This will stop the session timer and notify the staff to collect the final bill. Are you sure?", fontSize = 13.sp, color = Color.Gray)

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
                        Text("No, cancel", maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                    }

                    Button(
                        onClick = {
                            if (isSubmitting) return@Button
                            isSubmitting = true
                            errorMsg = null
                            viewModel.stopSession(
                                onSuccess = onDismiss,
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
                            Text("Yes, Finish", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
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
                        visualTransformation = PasswordVisualTransformation(),
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
fun CountdownCard(
    remainingSeconds: Long,
    remainingTime: String,
    session: com.gamehaus.app.data.SessionData,
    modifier: Modifier = Modifier
) {
    val isNearEnd = remainingSeconds < 300
    val pulseInfiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by pulseInfiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (isNearEnd) 1.05f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = EaseInOutQuad),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = if (isNearEnd) Color(0x1AEF4444) else Color(0xFF1E1E1E)
        ),
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(
            1.5.dp,
            if (isNearEnd) Color(0xFFEF4444).copy(alpha = 0.5f) else Color(0xFF2C2C2C)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "REMAINING TIME",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = if (isNearEnd) Color(0xFFEF4444) else Color.Gray,
                letterSpacing = 1.5.sp
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = remainingTime,
                fontSize = 48.sp,
                fontWeight = FontWeight.Black,
                color = if (isNearEnd) Color(0xFFEF4444) else Color.White,
                modifier = Modifier.scale(pulseScale)
            )
            Spacer(modifier = Modifier.height(16.dp))
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Black.copy(alpha = 0.2f))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.PlayCircleFilled,
                    contentDescription = null,
                    tint = Color.Gray,
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = "Started at ${formatTime(session.actual_start)}",
                    fontSize = 12.sp,
                    color = Color.Gray,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
fun BillAndActions(
    status: com.gamehaus.app.data.TabletStatus,
    session: com.gamehaus.app.data.SessionData,
    onExtendClick: () -> Unit,
    onBeverageClick: () -> Unit,
    onPlayerClick: () -> Unit,
    onStopClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1E1E)),
            shape = RoundedCornerShape(20.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "CURRENT BILL",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.Gray,
                        letterSpacing = 1.sp
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = String.format("₹%.2f", session.current_bill),
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White
                    )
                }
                Icon(
                    imageVector = Icons.Default.ReceiptLong,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(32.dp)
                )
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                ActionCard(
                    title = "Extend Time",
                    subtitle = "Add more minutes",
                    icon = Icons.Default.AddAlarm,
                    modifier = Modifier.weight(1f)
                ) { onExtendClick() }

                ActionCard(
                    title = "Order Snacks",
                    subtitle = "Drinks & beverages",
                    icon = Icons.Default.LocalPizza,
                    modifier = Modifier.weight(1f)
                ) { onBeverageClick() }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val hasTiers = status.table.people_pricing != null && status.table.people_pricing.isNotEmpty()
                ActionCard(
                    title = if (status.table.type == "ps5") "Controllers" else "Add Players",
                    subtitle = "Change group count",
                    icon = Icons.Default.People,
                    enabled = hasTiers,
                    modifier = Modifier.weight(1f)
                ) { onPlayerClick() }

                ActionCard(
                    title = "Finish Session",
                    subtitle = "Alert staff to checkout",
                    icon = Icons.Default.Stop,
                    modifier = Modifier.weight(1f)
                ) { onStopClick() }
            }
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
