import pandas as pd
import os
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes

# Загрузка переменных окружения
load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
if not TOKEN:
    raise ValueError("Токен бота не найден. Убедитесь, что переменная BOT_TOKEN задана в .env файле.")

# URL для экспорта таблицы в формате CSV
CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSrAMZV_aCBwnIwQOAiZOu8IMzO4xTpG14L6IUoYt-47T5aXJkj1KJRgVT_bg5IkUOdq5qCJlTQTZjV/pub?gid=78299199&single=true&output=csv"

# Обработка таблицы
def process_schedule():
    df = pd.read_csv(CSV_URL)
    df = df.drop(index=df.index[0])  # Удаление первой строки
    column_name = df.iloc[0][df.iloc[0] == '3а класс'].index[0]
    df = df[[column_name]]  # Оставляем только этот столбец
    df = df.rename(columns={column_name: '3a'})
    df = df.dropna()  # Удаление пустых строк
    df = df[~df['3a'].str.contains(r'Перемена|Перекус|Обед', na=False)]  # Удаление строк с перерывами
    df['3a'] = df['3a'].str.replace(r'\n', ' ', regex=True).str.strip()
    df['3a'] = df['3a'].str.replace(r'- ', '', regex=True)
    df = df.reset_index(drop=True)

    indexes = df[df['3a'] == '3а класс'].index.tolist()
    indexes.append(len(df))  # Добавить индекс последнего элемента

    days_of_week = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница']
    schedule = {}

    for i in range(5):
        day = df.iloc[indexes[i]+1:indexes[i+1]]
        schedule[days_of_week[i]] = day['3a'].tolist()

    return schedule

# Команда /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = [[InlineKeyboardButton("Расписание", callback_data="schedule")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("Добро пожаловать! Нажмите кнопку, чтобы получить расписание.", reply_markup=reply_markup)

# Обработка нажатия кнопки
async def button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    if query.data == "schedule":
        schedule = process_schedule()
        message = ""
        for day, lessons in schedule.items():
            message += f"========{day}=========\n"
            if lessons:
                message += "\n".join(lessons) + "\n\n"
            else:
                message += "Нет занятий\n\n"
        # Отправка расписания
        await query.message.reply_text(message)

        # Повторная отправка кнопок
        keyboard = [[InlineKeyboardButton("Расписание", callback_data="schedule")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.message.reply_text("Нажмите кнопку, чтобы снова получить расписание.", reply_markup=reply_markup)

# Запуск бота
if __name__ == "__main__":
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button))

    print("Бот запущен!")
    app.run_polling()