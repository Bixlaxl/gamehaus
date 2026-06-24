package com.gamehaus.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import com.gamehaus.app.ui.screens.DashboardScreen
import com.gamehaus.app.ui.screens.PairingScreen
import com.gamehaus.app.ui.theme.GamehausTheme
import com.gamehaus.app.viewmodel.MainViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by lazy {
        ViewModelProvider(this)[MainViewModel::class.java]
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            GamehausTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val isPaired by viewModel.isPaired.collectAsState()
                    if (isPaired) {
                        DashboardScreen(viewModel = viewModel)
                    } else {
                        PairingScreen(viewModel = viewModel)
                    }
                }
            }
        }
    }
}
