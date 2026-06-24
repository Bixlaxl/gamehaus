package com.gamehaus.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val OrangePrimary = Color(0xFFD4541A)
private val BackgroundDark = Color(0xFF111111)
private val SurfaceDark = Color(0xFF1E1E1E)
private val SurfaceDarkVariant = Color(0xFF2A2A2A)

private val DarkColorScheme = darkColorScheme(
    primary = OrangePrimary,
    onPrimary = Color.White,
    background = BackgroundDark,
    onBackground = Color.White,
    surface = SurfaceDark,
    onSurface = Color.White,
    surfaceVariant = SurfaceDarkVariant,
    onSurfaceVariant = Color(0xFFCCCCCC),
    error = Color(0xFFEF4444)
)

@Composable
fun GamehausTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
