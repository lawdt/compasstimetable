package com.lawdt.compass

import android.content.Context
import android.net.http.HttpResponseCache
import android.util.Log
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

// Файлы страницы берём с сайта, чтобы новый дизайн доходил до приложения
// вместе с деплоем, без переустановки. Без сети отдаём то, что скачали в
// прошлый раз, а если не скачивали ничего — копию, лежащую внутри apk.
//
// Адрес страницы при этом остаётся локальным: от него зависит localStorage,
// где лежат настройки и последнее расписание.
class SiteFiles(context: Context, private val origin: String) : WebViewAssetLoader.PathHandler {

    private val assets = WebViewAssetLoader.AssetsPathHandler(context)

    init {
        // Кэш понимает ETag сайта: повторный запуск обходится ответами 304.
        if (HttpResponseCache.getInstalled() == null) {
            HttpResponseCache.install(File(context.cacheDir, "site"), CACHE_SIZE)
        }
    }

    override fun handle(path: String): WebResourceResponse? {
        // config.js у приложения свой: в нём адрес сайта, а не пустая строка.
        if (path == "config.js") return assets.handle(path)

        val response = fetch(path, offline = false)
            ?: fetch(path, offline = true)
            ?: assets.handle(path)
            ?: return null
        return if (path == "index.html") withoutTelegram(response) else response
    }

    private fun fetch(path: String, offline: Boolean): WebResourceResponse? {
        val connection = URL("$origin/$path").openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.useCaches = true
            if (offline) {
                connection.setRequestProperty("Cache-Control", "only-if-cached, max-stale=31536000")
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                connection.disconnect()
                return null
            }
            val (mime, charset) = parseContentType(connection.contentType)
            WebResourceResponse(mime, charset, connection.inputStream)
        } catch (e: IOException) {
            if (!offline) Log.w(TAG, "не скачалось $path: ${e.message}")
            connection.disconnect()
            null
        }
    }

    // Скрипт Telegram в приложении не нужен: без него страница не считает
    // себя миниаппом и не ждёт ответов от несуществующего окружения.
    private fun withoutTelegram(response: WebResourceResponse): WebResourceResponse {
        val charset = response.encoding ?: "utf-8"
        val html = response.data.use(InputStream::readBytes).toString(charset(charset))
            .replace(TELEGRAM_SCRIPT, "")
        return WebResourceResponse(
            response.mimeType,
            charset,
            ByteArrayInputStream(html.toByteArray(charset(charset))),
        )
    }

    private fun parseContentType(value: String?): Pair<String, String?> {
        val parts = value.orEmpty().split(';').map(String::trim)
        val mime = parts.first().ifEmpty { "application/octet-stream" }
        val charset = parts.drop(1)
            .firstOrNull { it.startsWith("charset=", ignoreCase = true) }
            ?.substringAfter('=')
        return mime to charset
    }

    private companion object {
        const val TAG = "Compass"
        const val TIMEOUT_MS = 4000
        const val CACHE_SIZE = 4L * 1024 * 1024
        val TELEGRAM_SCRIPT = Regex("<script src=\"https://telegram\\.org/[^\"]*\"></script>\\s*")
    }
}
