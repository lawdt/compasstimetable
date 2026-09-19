plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Адрес, откуда приложение берёт расписание. Статика лежит внутри apk, а
// данные всегда свежие — поэтому обновление расписания не требует
// переустановки приложения.
val scheduleOrigin = "https://compass-bar-schedule.netlify.app"

android {
    namespace = "com.lawdt.compass"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.lawdt.compass"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}

// Статику миниаппа не дублируем в репозитории: перед сборкой она копируется
// из public/, а config.js подменяется на адрес сайта.
val syncWeb = tasks.register<Sync>("syncWeb") {
    from(rootProject.file("../public")) {
        exclude("__*.html")
    }
    into(layout.projectDirectory.dir("src/main/assets"))

    doLast {
        // Скрипт Telegram в приложении не нужен: без него страница не считает
        // себя миниаппом и не ждёт ответов от несуществующего окружения.
        val index = layout.projectDirectory.file("src/main/assets/index.html").asFile
        index.writeText(
            index.readText().replace(
                Regex("<script src=\"https://telegram\\.org/[^\"]*\"></script>\\s*"),
                "",
            ),
        )

        layout.projectDirectory.file("src/main/assets/config.js").asFile.writeText(
            "// Файл создаётся сборкой, правьте public/config.js.\n" +
                "window.COMPASS_API = '" + scheduleOrigin + "';\n",
        )
    }
}

tasks.named("preBuild") { dependsOn(syncWeb) }
