import os
import asyncio
import logging
import re
import urllib.parse
import aiohttp
from aiohttp import web
import time
import isodate
import math
import speedtest
import uuid
import random
from datetime import datetime, timedelta
from pymongo import ReturnDocument

# ─── MONKEY PATCH FOR COMPATIBILITY ───────────────────────────────────────
# This must run BEFORE importing pytgcalls to fix the ImportError
import pyrogram.errors
try:
    # Map the missing exception to the correct one existing in Pyrogram
    if not hasattr(pyrogram.errors, "GroupcallForbidden"):
        pyrogram.errors.GroupcallForbidden = pyrogram.errors.GroupCallForbidden
except AttributeError:
    # Fallback if even the standard one is missing
    class GroupcallForbidden(Exception):
        pass
    pyrogram.errors.GroupcallForbidden = GroupcallForbidden
# ──────────────────────────────────────────────────────────────────────────

from pyrogram import Client, filters, idle
from pyrogram.enums import ChatMemberStatus, ParseMode
from pyrogram.types import (
    InlineKeyboardButton, InlineKeyboardMarkup, CallbackQuery, ChatPermissions
)
from pyrogram.errors import (
    UserNotParticipant, ChatAdminRequired, UserAlreadyParticipant, PeerIdInvalid, RPCError
)
from pytgcalls import PyTgCalls, filters as fl
from pytgcalls.types import StreamEnded, Update

# MongoDB
from motor.motor_asyncio import AsyncIOMotorClient

# ─── Configuration ────────────────────────────────────────────────────────
API_ID = 29568441
API_HASH = "b32ec0fb66d22da6f77d355fbace4f2a"
BOT_TOKEN = os.getenv("BOT_TOKEN")
SESSION_STRING = os.getenv("ASSISTANT_SESSION")
MONGO_URI = "mongodb+srv://rj5706603:O95nvJYxapyDHfkw@cluster0.fzmckei.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"

if not BOT_TOKEN or not SESSION_STRING:
    print("Error: BOT_TOKEN or ASSISTANT_SESSION not found in environment variables.")

OWNER_ID = int(os.getenv('OWNER_ID', '7618467489'))

# APIs
SEARCH_API_URL = "https://search-api.kustbotsweb.workers.dev"
DOWNLOAD_API_BASE = "https://divine-dream-fde5.lagendplayersyt.workers.dev/down?url="

# Distributed System VPS Identifier
INSTANCE_ID = str(uuid.uuid4())

# ─── Database & State ─────────────────────────────────────────────────────
# { (bot_id, chat_id): [ {song_info}, ... ] }
chat_queues = {}
progress_tasks = {} # Stores the asyncio tasks for progress bars { (bot_id, chat_id): task }
assistant_cache = {} # Cache for assistant join status { (bot_id, chat_id): True }
bot_start_time = time.time()

# Bot Registry & Routing
# Added assistant username/name caching for dynamic mentioning
bot_registry = {} 

# Rate Limiting
user_command_history = {}
RATE_LIMIT_COUNT = 4
RATE_LIMIT_WINDOW = 6
ASSISTANT_ID = None

# MongoDB Setup
mongo_client = None
hosted_bots_collection = None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - [MusicBot] - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Ensure downloads directory exists
if not os.path.exists("downloads"):
    os.makedirs("downloads")

# ─── Clients Setup ────────────────────────────────────────────────────────

# 1. Main Bot Client
app = Client(
    "MusicBot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN
)

# 2. Assistant User Client (For Voice Chat)
user_app = Client(
    "MusicAssistant",
    api_id=API_ID,
    api_hash=API_HASH,
    session_string=SESSION_STRING
)

# 3. PyTgCalls Client (Audio Engine)
call_py = PyTgCalls(user_app)

# ─── Multi-Bot Hosting Context ────────────────────────────────────────────

def get_bot_context(bot_id):
    if bot_id in bot_registry:
        return bot_registry[bot_id]
    if hasattr(app, "me") and app.me:
        # Fallback to main context if dynamic fetch fails initially
        me_user = getattr(user_app, "me", None)
        ass_username = me_user.username if me_user else None
        ass_name = me_user.first_name if me_user else "Assistant"
        return {
            "bot": app, "user": user_app, "call": call_py, 
            "assistant_id": ASSISTANT_ID, "owner_id": OWNER_ID,
            "assistant_username": ass_username, "assistant_name": ass_name
        }
    return {"bot": app, "user": user_app, "call": call_py, "assistant_id": ASSISTANT_ID, "owner_id": OWNER_ID}

# ─── HTTP Logging Function ────────────────────────────────────────────────

async def send_play_log(current_app, chat_id, song_info):
    try:
        bot_name = current_app.me.first_name if hasattr(current_app, "me") and current_app.me else "Music Bot"
        try:
            chat_obj = await current_app.get_chat(chat_id)
            chat_title = chat_obj.title or str(chat_id)
        except:
            chat_title = str(chat_id)
            
        song_name = song_info.get("title", "Unknown")
        requester = song_info.get("req", "Unknown")
        
        # Log delivery details
        token = "7598576464:AAFtOfwYwLp1kcAFLmie99HVzubUVgtTU-k"
        log_chat_id = "-1002763195805"
        
        text = (
            f"🎵 <b>New Song Played</b>\n\n"
            f"🤖 <b>Bot:</b> {bot_name}\n"
            f"🏠 <b>Chat:</b> {chat_title}\n"
            f"🎶 <b>Song:</b> {song_name}\n"
            f"👤 <b>Requested By:</b> {requester}"
        )
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": log_chat_id,
            "text": text,
            "parse_mode": "HTML"
        }
        
        async with aiohttp.ClientSession() as session:
            await session.post(url, json=payload, timeout=5)
    except Exception as e:
        logger.error(f"Failed to send playback log: {e}")

# ─── Web API Routes ───────────────────────────────────────────────────────

routes = web.RouteTableDef()

@routes.get('/load')
async def get_load(request):
    return web.json_response({
        "live_vcs": len(progress_tasks),
        "total_running_bots": len(bot_registry),
        "instance_id": INSTANCE_ID
    })

@routes.get('/host')
async def host_bot_api(request):
    token = request.query.get("token")
    session = request.query.get("stringsession")
    owner_id = request.query.get("owner_id", str(OWNER_ID))
    
    if not token or not session:
        return web.json_response({"error": "Missing token or stringsession query parameters"}, status=400)

    try:
        bot_id_str = token.split(":")[0]
        bot_id = int(bot_id_str)
        owner_id = int(owner_id)
    except Exception:
        return web.json_response({"error": "Invalid token or owner_id format"}, status=400)

    # Persist the hosted bot to MongoDB ensuring it survives restarts
    if hosted_bots_collection is not None:
        await hosted_bots_collection.update_one(
            {"token": token},
            {"$set": {
                "bot_id": bot_id,
                "token": token, 
                "session": session,
                "owner_id": owner_id,
                "assigned_to": INSTANCE_ID,
                "last_active": datetime.utcnow()
            }},
            upsert=True
        )

    asyncio.create_task(start_one_hosted_bot(token, session, owner_id))
    return web.json_response({"status": "Success", "message": "Bot triggered to start/host"})

@routes.get('/delete')
async def delete_bot_api(request):
    token = request.query.get("token")
    if not token:
        return web.json_response({"error": "Missing token query parameter"}, status=400)

    try:
        bot_id_str = token.split(":")[0]
        bot_id = int(bot_id_str)
    except Exception:
        return web.json_response({"error": "Invalid token format"}, status=400)

    if hosted_bots_collection is not None:
        await hosted_bots_collection.delete_one({"token": token})

    if bot_id in bot_registry:
        if hasattr(app, "me") and app.me and bot_id == app.me.id:
            return web.json_response({"error": "Cannot delete the primary bot instance"}, status=400)

        b_ctx = bot_registry[bot_id]
        try:
            await b_ctx["call"].stop()
            await b_ctx["user"].stop()
            await b_ctx["bot"].stop()
        except Exception as e:
            logger.error(f"Error stopping deleted bot {bot_id}: {e}")
        
        del bot_registry[bot_id]
        return web.json_response({"status": "Success", "message": f"Bot {bot_id} stopped and deleted."})
    
    return web.json_response({"status": "Success", "message": "Bot deleted from database (was not actively running)."})

async def start_one_hosted_bot(token, session, owner_id):
    try:
        bot_id_str = token.split(":")[0]
        bot_id = int(bot_id_str)
        if bot_id in bot_registry:
            return

        bot_app = Client(
            f"bot_{bot_id_str}",
            api_id=API_ID,
            api_hash=API_HASH,
            bot_token=token,
            in_memory=True
        )
        u_app = Client(
            f"user_{bot_id_str}",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=session,
            in_memory=True
        )
        new_call = PyTgCalls(u_app)

        if hasattr(app.dispatcher, "groups"):
            for group, handlers in app.dispatcher.groups.items():
                for handler in handlers:
                    bot_app.add_handler(handler, group)

        @new_call.on_update(fl.stream_end())
        async def hosted_stream_end(cl, update):
            await on_stream_end(cl, update)

        await bot_app.start()
        await u_app.start()
        await new_call.start()

        me_bot = await bot_app.get_me()
        me_user = await u_app.get_me()

        bot_registry[me_bot.id] = {
            "bot": bot_app,
            "user": u_app,
            "call": new_call,
            "assistant_id": me_user.id,
            "assistant_username": me_user.username,
            "assistant_name": me_user.first_name,
            "owner_id": owner_id
        }
        logger.info(f"✅ Hosted bot started: @{me_bot.username} (Assistant ID: {me_user.id})")
        
        bot_db = mongo_client[f"musicbot_{me_bot.id}"]
        await bot_db.users.create_index("user_id", unique=True)
        await bot_db.chats.create_index("chat_id", unique=True)
        
    except Exception as e:
        logger.error(f"❌ Failed to start hosted bot {token[:10]}: {e}")
        err_str = str(e).lower()
        if any(x in err_str for x in ["revoke", "invalid", "unauthorized", "unregistered", "expire"]):
            if hosted_bots_collection is not None:
                await hosted_bots_collection.delete_one({"token": token})
                logger.info(f"🗑️ Removed dead/invalid bot {token[:10]} from database.")

async def load_hosted_bots():
    if hosted_bots_collection is None: return
    # Faster TTL check: Assume instance dead if no ping for 90 seconds
    dead_threshold = datetime.utcnow() - timedelta(seconds=90)
    
    cursor = hosted_bots_collection.find({
        "$or": [
            {"assigned_to": {"$exists": False}},
            {"assigned_to": None},
            {"last_active": {"$lt": dead_threshold}}
        ]
    })
    
    async for doc in cursor:
        token = doc.get("token")
        if not token: continue
        
        claimed_doc = await hosted_bots_collection.find_one_and_update(
            {
                "token": token,
                "$or": [
                    {"assigned_to": {"$exists": False}},
                    {"assigned_to": None},
                    {"last_active": {"$lt": dead_threshold}}
                ]
            },
            {"$set": {"assigned_to": INSTANCE_ID, "last_active": datetime.utcnow()}},
            return_document=ReturnDocument.AFTER
        )
        
        if claimed_doc:
            session = claimed_doc.get("session")
            owner_id = claimed_doc.get("owner_id", OWNER_ID)
            if token and session:
                await start_one_hosted_bot(token, session, owner_id)

async def bot_manager_task(is_main):
    await asyncio.sleep(random.uniform(2.0, 7.0))
    
    while True:
        try:
            # Renew main bot lock if this is the master instance
            if is_main and mongo_client is not None:
                db = mongo_client["musicbot_master"]
                await db["system_locks"].update_one(
                    {"lock_name": "main_bot", "instance_id": INSTANCE_ID},
                    {"$set": {"last_active": datetime.utcnow()}}
                )

            if hosted_bots_collection is not None:
                main_bot_id = app.me.id if hasattr(app, "me") and app.me else None
                active_bots = [bid for bid in bot_registry.keys() if bid != main_bot_id]
                if active_bots:
                    await hosted_bots_collection.update_many(
                        {"bot_id": {"$in": active_bots}, "assigned_to": INSTANCE_ID},
                        {"$set": {"last_active": datetime.utcnow()}}
                    )
            # Fetch all stored DB instances automatically resolving downtime restarts
            await load_hosted_bots()
        except Exception as e:
            logger.error(f"Bot manager task error: {e}")
            
        # Update TTL more frequently (every 30 seconds)
        await asyncio.sleep(30)

# ─── MongoDB & Distributed Locks ──────────────────────────────────────────

async def init_mongodb():
    global mongo_client, hosted_bots_collection
    try:
        mongo_client = AsyncIOMotorClient(MONGO_URI)
        master_db = mongo_client["musicbot_master"]
        hosted_bots_collection = master_db["hosted_bots"]
        await hosted_bots_collection.create_index("token", unique=True)
        await hosted_bots_collection.create_index("bot_id")
        
        # 1st action: Remove all old non-TTL locks so it doesn't block the startup
        try:
            await master_db["system_locks"].delete_many({"last_active": {"$exists": False}})
            logger.info("🧹 Cleared old non-TTL locks from the database.")
        except Exception as e:
            logger.error(f"Failed to clear non-TTL locks: {e}")
            
        logger.info(f"✅ MongoDB Connected successfully")
        return True
    except Exception as e:
        logger.error(f"❌ MongoDB Connection Failed: {e}")
        return False

async def claim_main_instance():
    """Distributed lock to ensure only one Dyno runs the primary bot"""
    if mongo_client is None: return False
    try:
        db = mongo_client["musicbot_master"]
        locks = db["system_locks"]
        
        try:
            await locks.create_index("lock_name", unique=True)
        except Exception:
            pass
            
        now = datetime.utcnow()
        # Faster TTL lock switch: 60 seconds of unresponsiveness triggers failover
        dead_threshold = now - timedelta(seconds=60)
        
        # Try to acquire an expired lock or renew our own lock
        updated = await locks.find_one_and_update(
            {
                "lock_name": "main_bot",
                "$or": [
                    {"instance_id": INSTANCE_ID},
                    {"last_active": {"$lt": dead_threshold}}
                ]
            },
            {"$set": {"instance_id": INSTANCE_ID, "last_active": now}},
            return_document=ReturnDocument.AFTER
        )
        
        if updated:
            return True
            
        # If lock completely missing, insert it
        try:
            await locks.insert_one({
                "lock_name": "main_bot",
                "instance_id": INSTANCE_ID,
                "last_active": now
            })
            return True
        except Exception:
            pass
            
        return False
    except Exception as e:
        logger.error(f"Lock DB Error: {e}")
        return False

async def register_user(bot_id, user):
    if mongo_client is None: return False
    try:
        db = mongo_client[f"musicbot_{bot_id}"]
        user_data = {
            "user_id": user.id,
            "first_name": user.first_name or "",
            "last_name": user.last_name or "",
            "username": user.username or "",
            "is_bot": user.is_bot if hasattr(user, 'is_bot') else False,
            "last_seen": datetime.utcnow()
        }
        await db.users.update_one(
            {"user_id": user.id},
            {
                "$set": user_data,
                "$setOnInsert": {"registered_at": datetime.utcnow()}
            },
            upsert=True
        )
        return True
    except Exception as e:
        return False

async def register_chat(bot_id, chat_id):
    if mongo_client is None or chat_id > 0: return False 
    try:
        db = mongo_client[f"musicbot_{bot_id}"]
        await db.chats.update_one(
            {"chat_id": chat_id},
            {
                "$set": {"chat_id": chat_id, "last_active": datetime.utcnow()},
                "$setOnInsert": {"registered_at": datetime.utcnow()}
            },
            upsert=True
        )
        return True
    except Exception as e:
        return False

async def get_all_targets(bot_id):
    if mongo_client is None: return []
    targets = []
    try:
        db = mongo_client[f"musicbot_{bot_id}"]
        async for doc in db.users.find({}, {"user_id": 1}):
            if "user_id" in doc: targets.append(doc["user_id"])
        async for doc in db.chats.find({}, {"chat_id": 1}):
            if "chat_id" in doc: targets.append(doc["chat_id"])
        return list(set(targets))
    except Exception as e:
        return []

async def get_stats_count(bot_id):
    if mongo_client is None: return 0, 0
    try:
        db = mongo_client[f"musicbot_{bot_id}"]
        users = await db.users.count_documents({})
        chats = await db.chats.count_documents({})
        return users, chats
    except Exception as e:
        return 0, 0

# ─── UI & Helper Functions ────────────────────────────────────────────────

def get_system_stats():
    try:
        load1, load5, load15 = os.getloadavg()
        cpu_usage = f"{load1:.2f} (Load)"
    except Exception:
        cpu_usage = "N/A"
    try:
        with open('/proc/meminfo', 'r') as f:
            lines = f.readlines()
        mem_dict = {}
        for line in lines:
            parts = line.split(':')
            if len(parts) == 2:
                mem_dict[parts[0].strip()] = int(parts[1].split()[0])
        total = mem_dict.get('MemTotal', 1)
        free = mem_dict.get('MemFree', 0)
        buffers = mem_dict.get('Buffers', 0)
        cached = mem_dict.get('Cached', 0)
        used = total - free - buffers - cached
        mem_usage = f"{(used / total) * 100:.1f}%"
    except Exception:
        mem_usage = "N/A"
    try:
        statvfs = os.statvfs('/')
        total_disk = statvfs.f_blocks * statvfs.f_frsize
        free_disk = statvfs.f_bavail * statvfs.f_frsize
        used_disk = total_disk - free_disk
        disk_usage = f"{(used_disk / total_disk) * 100:.1f}%"
    except Exception:
        disk_usage = "N/A"
    return cpu_usage, mem_usage, disk_usage


def to_bold_unicode(text):
    maps = {
        'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠', 'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
        'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺', 'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝗲', 'y': '𝘆', 'z': '𝘇',
        '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟟', '8': '𝟴', '9': '𝟵'
    }
    return "".join(maps.get(c, c) for c in text)

MAX_TITLE_LEN = 30

def _one_line_title(full_title: str) -> str:
    if len(full_title) <= MAX_TITLE_LEN:
        return full_title
    else:
        return full_title[: (MAX_TITLE_LEN - 1) ] + "…"

def parse_duration_str(duration_str: str) -> int:
    try:
        duration = isodate.parse_duration(duration_str)
        return int(duration.total_seconds())
    except Exception:
        if ':' in str(duration_str):
            try:
                parts = [int(x) for x in str(duration_str).split(':')]
                if len(parts) == 2:
                    return parts[0] * 60 + parts[1]
                elif len(parts) == 3:
                    return parts[0] * 3600 + parts[1] * 60 + parts[2]
            except:
                pass
        return 0

def format_time(seconds: float) -> str:
    secs = int(seconds)
    m, s = divmod(secs, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    else:
        return f"{m}:{s:02d}"

def get_progress_bar_styled(elapsed: float, total: float, bar_length: int = 14) -> str:
    if total <= 0:
        return "LIVE 🔴"
    fraction = min(elapsed / total, 1)
    marker_index = int(fraction * bar_length)
    if marker_index >= bar_length:
        marker_index = bar_length - 1
    left = "━" * marker_index
    right = "─" * (bar_length - marker_index - 1)
    bar = left + "❄️" + right
    return f"{format_time(elapsed)} {bar} {format_time(total)}"

def get_readable_time(seconds: int) -> str:
    count = 0
    ping_time = ""
    time_list = []
    time_suffix_list = ["s", "m", "h", "days"]
    while count < 4:
        count += 1
        remainder, result = divmod(seconds, 60) if count < 3 else divmod(seconds, 24)
        if seconds == 0 and remainder == 0:
            break
        time_list.append(int(result))
        seconds = int(remainder)
    for x in range(len(time_list)):
        time_list[x] = str(time_list[x]) + time_suffix_list[x]
    if len(time_list) == 4:
        ping_time += time_list.pop() + ", "
        time_list.reverse()
    ping_time += ":".join(time_list)
    return ping_time

async def update_progress_caption(chat_id, message, start_time, total_duration, base_caption):
    try:
        while True:
            elapsed = time.time() - start_time
            if elapsed > total_duration and total_duration > 0:
                elapsed = total_duration
            
            progress_bar = get_progress_bar_styled(elapsed, total_duration)
            
            control_row = [
                InlineKeyboardButton(text="▷", callback_data="resume", style="success"),
                InlineKeyboardButton(text="II", callback_data="pause", style="secondary"),
                InlineKeyboardButton(text="‣‣I", callback_data="skip", style="primary"),
                InlineKeyboardButton(text="▢", callback_data="stop", style="danger")
            ]
            
            progress_button = InlineKeyboardButton(text=progress_bar, callback_data="progress", style="secondary", icon_custom_emoji_id="5971944878815317190")
            
            new_keyboard = InlineKeyboardMarkup([
                [progress_button],
                control_row
            ])
            
            try:
                await message.edit_caption(
                    caption=base_caption,
                    reply_markup=new_keyboard,
                    parse_mode=ParseMode.HTML
                )
            except Exception as e:
                if "MESSAGE_NOT_MODIFIED" not in str(e):
                    break
            
            if elapsed >= total_duration and total_duration > 0:
                break
                
            await asyncio.sleep(10)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"Progress Loop Error: {e}")

async def is_admin(bot_id, chat_id, user_id):
    try:
        ctx = get_bot_context(bot_id)
        member = await ctx["bot"].get_chat_member(chat_id, user_id)
        return member.status in [ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.OWNER]
    except:
        return False

async def check_abuse(user_id):
    now = time.time()
    if user_id not in user_command_history:
        user_command_history[user_id] = []
    history = [t for t in user_command_history[user_id] if now - t < RATE_LIMIT_WINDOW]
    if len(history) >= RATE_LIMIT_COUNT:
        return True
    history.append(now)
    user_command_history[user_id] = history
    return False

async def check_assistant_in_chat(bot_id, chat_id, who):
    try:
        ctx = get_bot_context(bot_id)
        member = await ctx["bot"].get_chat_member(chat_id=chat_id, user_id=who)
        status = getattr(member, "status", None)
        if hasattr(status, "value"): return status.value
        if isinstance(status, str): return status
        return str(status) if status is not None else False
    except UserNotParticipant:
        return False
    except RPCError as e:
        msg = str(e).upper()
        if "USER_BANNED" in msg: return "banned"
        return False
    except Exception:
        return False

# ─── Background Downloads ────────────────────────────────────────────────

async def bg_download(song_dict):
    """Background task to preemptively download songs in queue"""
    if not song_dict.get("file_path"):
        try:
            path = await download_song(song_dict["url"])
            if path and os.path.exists(path):
                song_dict["file_path"] = path
        except Exception as e:
            logger.error(f"Background DL Error: {e}")

# ─── API & Download Functions ─────────────────────────────────────────────

async def fetch_youtube_link(query):
    try:
        async with aiohttp.ClientSession() as session:
            url = f"{SEARCH_API_URL}/search?q={urllib.parse.quote(query)}"
            async with session.get(url, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    if isinstance(data, dict): return data
                    elif isinstance(data, list) and data: return data[0]
                    return None
    except Exception as e:
        logger.error(f"[Search API] Error: {e}")
        return None

async def download_song(youtube_url):
    try:
        file_name = f"downloads/{str(time.time())}.mp3"
        download_url = f"{DOWNLOAD_API_BASE}{youtube_url}"
        async with aiohttp.ClientSession() as session:
            async with session.get(download_url, timeout=600) as response:
                if response.status == 200:
                    with open(file_name, 'wb') as f:
                        async for chunk in response.content.iter_chunked(1024):
                            f.write(chunk)
                    return file_name
                else:
                    return None
    except Exception as e:
        logger.error(f"[Download API] Exception: {e}")
        return None

# ─── Playback Logic ───────────────────────────────────────────────────────

async def play_music_core(bot_id, chat_id, song_info, status_msg=None, retry_attempt=False):
    global assistant_cache
    ctx = get_bot_context(bot_id)
    current_app = ctx["bot"]
    current_user = ctx["user"]
    current_call = ctx["call"]
    current_assistant_id = ctx["assistant_id"]
    q_key = (bot_id, chat_id)

    try:
        # 1. CHECK & INVITE ASSISTANT
        if q_key in assistant_cache and not retry_attempt:
            pass
        else:
            is_participant = await check_assistant_in_chat(bot_id, chat_id, current_assistant_id)
            if not is_participant:
                if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='5971944878815317190'>🔍</tg-emoji> <b>Assistant not in chat.</b>\n<i>Generating invite link...</i>", parse_mode=ParseMode.HTML)
                try:
                    invite_link = await current_app.export_chat_invite_link(chat_id)
                    try:
                        await current_user.join_chat(invite_link)
                    except Exception as e:
                        if "INVITE_HASH_EXPIRED" in str(e).upper():
                            # Generate brand new link if exported one is dead
                            new_link = await current_app.create_chat_invite_link(chat_id)
                            await current_user.join_chat(new_link.invite_link)
                        else:
                            raise e
                    
                    if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Assistant Joined successfully.</b>", parse_mode=ParseMode.HTML)
                    await asyncio.sleep(2)
                except UserAlreadyParticipant:
                    if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Assistant is already in the chat.</b>", parse_mode=ParseMode.HTML)
                    await asyncio.sleep(1)
                except Exception as e:
                    # Provide exact mention of the assistant username/name so users know who to add
                    ass_mention = f"@{ctx['assistant_username']}" if ctx.get('assistant_username') else f"<a href='tg://user?id={ctx['assistant_id']}'>{ctx.get('assistant_name', 'Assistant')}</a>"
                    
                    if status_msg: await status_msg.edit_text(
                        f"<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Assistant Join Failed:</b>\n<code>{e}</code>\n\n"
                        f"<tg-emoji emoji-id='5971944878815317190'>💡</tg-emoji> <b>Fix:</b> Please manually add the assistant {ass_mention} to this chat and try playing again.",
                        parse_mode=ParseMode.HTML
                    )
                    return
            
            assistant_cache[q_key] = True
            try: await current_user.get_chat(chat_id)
            except: pass

        # 2. Download Audio
        file_path = song_info.get('file_path')
        if file_path and os.path.exists(file_path):
            pass 
        else:
            if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='6158862632926319619'>📥</tg-emoji> <b>Downloading Audio...</b>", parse_mode=ParseMode.HTML)
            target_url = song_info["url"]
            file_path = await download_song(target_url)
            
            if not file_path or not os.path.exists(file_path):
                if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Download Failed.</b>\n<i>Skipping to the next track...</i>", parse_mode=ParseMode.HTML)
                # Auto-Skip on error
                if q_key in chat_queues and chat_queues[q_key]: 
                    chat_queues[q_key].pop(0)
                    if chat_queues[q_key]:
                        return await play_music_core(bot_id, chat_id, chat_queues[q_key][0])
                return
            song_info['file_path'] = file_path

        # 3. Start Playback
        if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='5462921117423384478'>🎧</tg-emoji> <b>Started Streaming...</b>", parse_mode=ParseMode.HTML)
        
        try:
            await current_call.play(chat_id, file_path)
            
            # 🚀 Fire logging function to the master log channel
            asyncio.create_task(send_play_log(current_app, chat_id, song_info))
            
        except Exception as e:
            if not retry_attempt:
                logger.warning(f"Playback failed ({e}). Invalidating cache and retrying...")
                if q_key in assistant_cache:
                    del assistant_cache[q_key]
                if status_msg: await status_msg.edit_text("<tg-emoji emoji-id='5972240522889138094'>🔄</tg-emoji> <b>Connection Error. Refreshing...</b>", parse_mode=ParseMode.HTML)
                await asyncio.sleep(1.5)
                return await play_music_core(bot_id, chat_id, song_info, status_msg, retry_attempt=True)
            else:
                if "PeerIdInvalid" in str(e):
                    await asyncio.sleep(2)
                    await current_user.get_chat(chat_id)
                    await current_call.play(chat_id, file_path)
                else:
                    raise e

        # 4. Cleanup Old Progress Task
        if q_key in progress_tasks:
            progress_tasks[q_key].cancel()
            del progress_tasks[q_key]

        # 5. Prepare New UI
        bot_name = current_app.me.first_name if hasattr(current_app, "me") and current_app.me else "Music Bot"
        one_line = _one_line_title(song_info['title'])
        total_duration = parse_duration_str(song_info.get("duration", "0"))
        
        base_caption = (
            "<blockquote>"
            f"<b><tg-emoji emoji-id='6325413811033477368'>✨</tg-emoji> {bot_name} ✘ ᴍᴜsɪᴄ sᴛʀєᴀᴍɪɴɢ ⏤͟͞●</b></blockquote>\n\n"
            f"<blockquote>❍ <b>ᴛɪᴛʟᴇ:</b> {one_line}\n"
            f"❍ <b>ʀᴇǫᴜᴇsᴛᴇᴅ ʙʏ:</b> {song_info['req']}"
            "</blockquote>\n\n"
            "<tg-emoji emoji-id='5972240522889138094'>⚡</tg-emoji> <b>Powered by <a href='https://t.me/kustbots'>KustBots</a></b>"
        )
        
        initial_progress = get_progress_bar_styled(0, total_duration)
        
        control_buttons = InlineKeyboardMarkup([
            [
                InlineKeyboardButton(text=initial_progress, callback_data="progress", style="secondary", icon_custom_emoji_id="5971944878815317190")
            ],
            [
                InlineKeyboardButton(text="▷", callback_data="resume", style="success"),
                InlineKeyboardButton(text="II", callback_data="pause", style="secondary"),
                InlineKeyboardButton(text="‣‣I", callback_data="skip", style="primary"),
                InlineKeyboardButton(text="▢", callback_data="stop", style="danger"),
            ]
        ])

        if status_msg:
            await status_msg.delete()

        # Send Player UI
        player_message = None
        if song_info['thumb'] and song_info['thumb'].startswith("http"):
            try:
                player_message = await current_app.send_photo(
                    chat_id, 
                    photo=song_info['thumb'], 
                    caption=base_caption, 
                    reply_markup=control_buttons, 
                    parse_mode=ParseMode.HTML
                )
            except:
                pass
        
        if not player_message:
            player_message = await current_app.send_message(
                chat_id, 
                base_caption, 
                reply_markup=control_buttons, 
                parse_mode=ParseMode.HTML, 
                disable_web_page_preview=True
            )

        # 6. Start Progress Update Task
        if player_message:
            task = asyncio.create_task(
                update_progress_caption(chat_id, player_message, time.time(), total_duration, base_caption)
            )
            progress_tasks[q_key] = task

    except Exception as e:
        logger.error(f"Playback Error: {e}")
        if status_msg:
            try: await status_msg.edit_text(f"<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Error:</b> {str(e)}\n<tg-emoji emoji-id='5972240522889138094'>⏭</tg-emoji> <b>Skipping...</b>", parse_mode=ParseMode.HTML)
            except: pass
        # Auto-Skip on generic playback failure
        if q_key in chat_queues and chat_queues[q_key]:
            chat_queues[q_key].pop(0)
            if chat_queues[q_key]:
                await play_music_core(bot_id, chat_id, chat_queues[q_key][0])
            else:
                try: await current_call.leave_call(chat_id)
                except: pass

# ─── Handlers ─────────────────────────────────────────────────────────────

@app.on_message(filters.command(["ping", "alive"]))
async def ping_handler(client, message):
    start = time.time()
    response = await message.reply_text("<tg-emoji emoji-id='6300733352697661457'>🏓</tg-emoji> <b>Pinging...</b>", parse_mode=ParseMode.HTML)
    end = time.time()
    
    tg_ping = round((end - start) * 1000)
    api_ping = "N/A"
    try:
        api_start = time.time()
        async with aiohttp.ClientSession() as session:
            async with session.get(DOWNLOAD_API_BASE, timeout=5) as resp:
                pass 
        api_end = time.time()
        api_ping = f"{round((api_end - api_start) * 1000)}ms"
    except Exception:
        api_ping = "Timeout"

    mongo_status = "✅ Connected" if mongo_client else "❌ Not Connected"
    users_count, chats_count = await get_stats_count(client.me.id)
    uptime = get_readable_time(int(time.time() - bot_start_time))
    cpu, mem, disk = get_system_stats()
    
    msg = (
        f"<tg-emoji emoji-id='5971944878815317190'>🏓</tg-emoji> <b>Pong!</b>\n\n"
        f"<tg-emoji emoji-id='5972240522889138094'>📱</tg-emoji> <b>Telegram Latency:</b> <code>{tg_ping}ms</code>\n"
        f"<tg-emoji emoji-id='6158862632926319619'>📥</tg-emoji> <b>Download API:</b> <code>{api_ping}</code>\n"
        f"<tg-emoji emoji-id='5462921117423384478'>🗄</tg-emoji> <b>Database:</b> <code>{mongo_status}</code> ({users_count} users, {chats_count} chats)\n\n"
        f"<tg-emoji emoji-id='6300733352697661457'>💻</tg-emoji> <b>System Stats:</b>\n"
        f"├ <b>Uptime:</b> <code>{uptime}</code>\n"
        f"├ <b>CPU:</b> <code>{cpu}</code>\n"
        f"├ <b>RAM:</b> <code>{mem}</code>\n"
        f"└ <b>Disk:</b> <code>{disk}</code>"
    )
    
    await response.edit_text(msg, parse_mode=ParseMode.HTML)

def speedtest_cli():
    try:
        test = speedtest.Speedtest()
        test.get_best_server()
        test.download()
        test.upload()
        test.results.share()
        return test.results.dict()
    except Exception as e:
        return str(e)

@app.on_message(filters.command(["speedtest", "st"]))
async def speedtest_command(client, message):
    if await check_abuse(message.from_user.id):
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>⏳</tg-emoji> <b>Slow down. You are sending commands too fast.</b>", parse_mode=ParseMode.HTML)

    status = await message.reply_text("<tg-emoji emoji-id='5972240522889138094'>⚡</tg-emoji> <b>Running Speedtest...</b>\n<i>Checking server speed, please wait...</i>", parse_mode=ParseMode.HTML)
    
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, speedtest_cli)
    
    if isinstance(result, str):
        return await status.edit_text(f"<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Speedtest Failed:</b>\n<code>{result}</code>", parse_mode=ParseMode.HTML)
    
    dl = f"{result['download'] / 1024 / 1024:.2f} Mbps"
    ul = f"{result['upload'] / 1024 / 1024:.2f} Mbps"
    ping = f"{result['ping']} ms"
    isp = result['client']['isp']
    rating = result['client']['rating']
    share_url = result['share']
    
    caption = (
        f"<tg-emoji emoji-id='5972240522889138094'>🚀</tg-emoji> <b>Speedtest Results</b>\n\n"
        f"<tg-emoji emoji-id='6158862632926319619'>📥</tg-emoji> <b>Download:</b> <code>{dl}</code>\n"
        f"<tg-emoji emoji-id='5462921117423384478'>📤</tg-emoji> <b>Upload:</b> <code>{ul}</code>\n"
        f"<tg-emoji emoji-id='5971944878815317190'>📶</tg-emoji> <b>Ping:</b> <code>{ping}</code>\n"
        f"<tg-emoji emoji-id='6300733352697661457'>🌐</tg-emoji> <b>ISP:</b> <code>{isp}</code>\n"
        f"<tg-emoji emoji-id='6325413811033477368'>⭐</tg-emoji> <b>Rating:</b> <code>{rating}</code>"
    )
    
    await status.delete()
    await message.reply_photo(photo=share_url, caption=caption, parse_mode=ParseMode.HTML)

@app.on_message(filters.command("start"))
async def start_handler(client, message):
    if await check_abuse(message.from_user.id): return

    if message.from_user:
        await register_user(client.me.id, message.from_user)

    bot_ctx = get_bot_context(client.me.id)
    current_owner_id = bot_ctx.get("owner_id", OWNER_ID)

    user_link = f"<a href='tg://user?id={message.from_user.id}'>{message.from_user.first_name}</a>"
    bot_name_bold = to_bold_unicode(client.me.first_name.upper())
    
    caption = (
        f"<tg-emoji emoji-id='6300733352697661457'>👋</tg-emoji> <b>Hello {user_link}!</b>\n\n"
        f"<b>Welcome to {bot_name_bold}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"<tg-emoji emoji-id='5972240522889138094'>✨</tg-emoji> <b>Premium Music Experience</b>\n"
        f"<tg-emoji emoji-id='5462921117423384478'>🎧</tg-emoji> <b>Audio:</b> High Quality Streaming\n"
        f"<tg-emoji emoji-id='6158862632926319619'>🛡️</tg-emoji> <b>Security:</b> Built-in Group Protection\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"<tg-emoji emoji-id='5971944878815317190'>💡</tg-emoji> <i>Click the buttons below to explore!</i>"
    )
    
    buttons = [
        [InlineKeyboardButton("Add Me to Your Group", url=f"https://t.me/{client.me.username}?startgroup=true", style="green", icon_custom_emoji_id="5972240522889138094")],
        [InlineKeyboardButton("Commands", callback_data="show_help", style="blue", icon_custom_emoji_id="5462921117423384478"), InlineKeyboardButton("Updates", url="https://t.me/kustbots", style="blue", icon_custom_emoji_id="6158862632926319619")],
        [InlineKeyboardButton("Owner", url=f"tg://openmessage?user_id={current_owner_id}", style="blue", icon_custom_emoji_id="5971944878815317190")]
    ]
    
    bot_dp = None
    try:
        async for photo in client.get_chat_photos(client.me.id, limit=1):
            bot_dp = photo.file_id
            break
    except Exception as e:
        logger.warning(f"Could not fetch bot DP: {e}")

    if bot_dp:
        await message.reply_photo(
            photo=bot_dp,
            caption=caption,
            parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup(buttons)
        )
    else:
        await message.reply_text(
            caption, 
            parse_mode=ParseMode.HTML, 
            reply_markup=InlineKeyboardMarkup(buttons)
        )

@app.on_message(filters.command(["play", "p"]) & filters.group)
async def play_command(client, message):
    chat_id = message.chat.id
    bot_id = client.me.id
    q_key = (bot_id, chat_id)
    
    if await check_abuse(message.from_user.id):
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>⏳</tg-emoji> <b>Slow down. You are sending commands too fast.</b>", parse_mode=ParseMode.HTML)

    if message.from_user:
        await register_user(bot_id, message.from_user)

    query = " ".join(message.command[1:])
    requester = message.from_user.mention
    
    if not query:
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Usage:</b> <code>/play &lt;song name or url&gt;</code>", parse_mode=ParseMode.HTML)
    
    status_msg = await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>🔎</tg-emoji> <b>Searching for your track...</b>", parse_mode=ParseMode.HTML)

    if "youtu.be" in query:
        m = re.search(r"youtu\.be/([^?&]+)", query)
        if m: query = f"https://www.youtube.com/watch?v={m.group(1)}"

    result = await fetch_youtube_link(query)
    
    if not result:
        return await status_msg.edit_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>No results found.</b>", parse_mode=ParseMode.HTML)

    title = result.get("title")
    url = result.get("link")
    thumb = result.get("thumbnail")
    duration_raw = result.get("duration", "0")
    
    song_info = {
        "title": title, "url": url, "duration": str(duration_raw),
        "thumb": thumb, "req": requester, "user_id": message.from_user.id,
        "file_path": None
    }

    if q_key not in chat_queues:
        chat_queues[q_key] = []
    
    chat_queues[q_key].append(song_info)

    if len(chat_queues[q_key]) == 1:
        await play_music_core(bot_id, chat_id, song_info, status_msg)
    else:
        # Pre-cache Background Download for upcoming tracks
        asyncio.create_task(bg_download(song_info))

        queue_len = len(chat_queues[q_key]) - 1
        queue_text = (
            f"<b><tg-emoji emoji-id='5972240522889138094'>✨</tg-emoji> ᴀᴅᴅᴇᴅ ᴛᴏ ǫᴜᴇᴜᴇ:</b>\n\n"
            f"<b>❍ ᴛɪᴛʟᴇ:</b> {title}\n"
            f"<b>❍ ᴘᴏsɪᴛɪᴏɴ:</b> {queue_len}"
        )
        
        queue_buttons = InlineKeyboardMarkup([
            [InlineKeyboardButton("⏭ Skip", callback_data="skip", style="primary"),
             InlineKeyboardButton("🗑 Clear", callback_data="clear", style="danger")]
        ])
        
        await status_msg.edit_text(queue_text, parse_mode=ParseMode.HTML, reply_markup=queue_buttons)

@app.on_message(filters.command(["stop", "end"]) & filters.group)
async def stop_command(client, message):
    chat_id = message.chat.id
    bot_id = client.me.id
    q_key = (bot_id, chat_id)
    ctx = get_bot_context(bot_id)
    
    if not await is_admin(bot_id, chat_id, message.from_user.id): return
    
    if q_key in progress_tasks:
        progress_tasks[q_key].cancel()
        del progress_tasks[q_key]

    if q_key in chat_queues:
        chat_queues[q_key] = []
    
    try:
        await ctx["call"].leave_call(chat_id)
    except:
        pass
        
    await message.reply_text("<tg-emoji emoji-id='6158862632926319619'>⏹</tg-emoji> <b>Playback stopped & disconnected.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command("skip") & filters.group)
async def skip_command(client, message):
    chat_id = message.chat.id
    bot_id = client.me.id
    q_key = (bot_id, chat_id)
    ctx = get_bot_context(bot_id)
    
    if not await is_admin(bot_id, chat_id, message.from_user.id): return
    
    if q_key in progress_tasks:
        progress_tasks[q_key].cancel()
        del progress_tasks[q_key]

    if q_key in chat_queues and chat_queues[q_key]:
        current_song = chat_queues[q_key][0]
        chat_queues[q_key].pop(0)
        
        if current_song.get('file_path') and os.path.exists(current_song['file_path']):
            try: os.remove(current_song['file_path'])
            except: pass
        
        if chat_queues[q_key]:
            next_song = chat_queues[q_key][0]
            await message.reply_text("<tg-emoji emoji-id='5972240522889138094'>⏭</tg-emoji> <b>Skipped to the next track.</b>", parse_mode=ParseMode.HTML)
            await play_music_core(bot_id, chat_id, next_song)
        else:
            await register_chat(bot_id, chat_id)
            try: await ctx["call"].leave_call(chat_id)
            except: pass
            await message.reply_text("<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Queue finished. Leaving voice chat.</b>", parse_mode=ParseMode.HTML)
    else:
        await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Nothing to skip. The queue is empty.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command(["clear", "clean"]) & filters.group)
async def clear_command(client, message):
    chat_id = message.chat.id
    bot_id = client.me.id
    q_key = (bot_id, chat_id)
    ctx = get_bot_context(bot_id)
    
    if not await is_admin(bot_id, chat_id, message.from_user.id): return
    
    # Drops the entire queue entirely
    if q_key in chat_queues and len(chat_queues[q_key]) > 0:
        chat_queues[q_key] = []  # Completely Empty
        
        # Cancel Progress Task
        if q_key in progress_tasks:
            progress_tasks[q_key].cancel()
            del progress_tasks[q_key]

        # Force bot to leave call since queue is 0
        try:
            await ctx["call"].leave_call(chat_id)
        except:
            pass

        await message.reply_text("<tg-emoji emoji-id='5462921117423384478'>🗑</tg-emoji> <b>Queue cleared & Playback stopped.</b>", parse_mode=ParseMode.HTML)
        await register_chat(bot_id, chat_id)
    else:
        await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Queue is already empty.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command("pause") & filters.group)
async def pause_command(client, message):
    bot_id = client.me.id
    ctx = get_bot_context(bot_id)
    if not await is_admin(bot_id, message.chat.id, message.from_user.id): return
    try:
        await ctx["call"].pause(message.chat.id)
        await message.reply_text("<tg-emoji emoji-id='5462921117423384478'>⏸</tg-emoji> <b>Playback Paused.</b>", parse_mode=ParseMode.HTML)
    except: pass

@app.on_message(filters.command("resume") & filters.group)
async def resume_command(client, message):
    bot_id = client.me.id
    ctx = get_bot_context(bot_id)
    if not await is_admin(bot_id, message.chat.id, message.from_user.id): return
    try:
        await ctx["call"].resume(message.chat.id)
        await message.reply_text("<tg-emoji emoji-id='5972240522889138094'>▶️</tg-emoji> <b>Playback Resumed.</b>", parse_mode=ParseMode.HTML)
    except: pass

# ─── BROADCAST COMMAND ────────────────────────────────────────

@app.on_message(filters.command("broadcast") & filters.private)
async def broadcast_command(client, message):
    user_id = message.from_user.id
    bot_id = client.me.id
    
    bot_ctx = get_bot_context(bot_id)
    allowed_owners = [OWNER_ID, bot_ctx.get("owner_id", OWNER_ID)]
    
    if user_id not in allowed_owners:
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>This command is restricted to the bot owner only.</b>", parse_mode=ParseMode.HTML)
    
    if mongo_client is None:
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Database not connected. Cannot broadcast.</b>", parse_mode=ParseMode.HTML)
    
    if message.reply_to_message:
        broadcast_msg = message.reply_to_message
    else:
        query = " ".join(message.command[1:])
        if not query:
            return await message.reply_text(
                "<b><tg-emoji emoji-id='6300733352697661457'>📢</tg-emoji> Broadcast Usage:</b>\n\n"
                "• Reply to a message with <code>/broadcast</code> to forward it\n"
                "• Or use <code>/broadcast &lt;message&gt;</code> to send text\n\n"
                "<b>Example:</b>\n"
                "<code>/broadcast Hello everyone! New update available.</code>",
                parse_mode=ParseMode.HTML
            )
        broadcast_msg = None 
    
    targets = await get_all_targets(bot_id)
    total_targets = len(targets)
    
    if total_targets == 0:
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>No registered users or chats found.</b>", parse_mode=ParseMode.HTML)
    
    confirm_text = (
        f"<tg-emoji emoji-id='6300733352697661457'>📢</tg-emoji> <b>Broadcast Confirmation</b>\n\n"
        f"<tg-emoji emoji-id='5972240522889138094'>👥</tg-emoji> <b>Total Targets (Users + Chats):</b> <code>{total_targets}</code>\n\n"
        f"<b>Do you want to proceed?</b>"
    )
    
    confirm_buttons = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Yes, Broadcast", callback_data=f"broadcast_yes_{user_id}", style="success"),
            InlineKeyboardButton("❌ Cancel", callback_data=f"broadcast_no_{user_id}", style="danger")
        ]
    ])
    
    if not hasattr(client, 'broadcast_data'):
        client.broadcast_data = {}
    
    client.broadcast_data[user_id] = {
        'targets': targets,
        'message': broadcast_msg,
        'text': query if not broadcast_msg else None
    }
    
    await message.reply_text(confirm_text, reply_markup=confirm_buttons, parse_mode=ParseMode.HTML)

@app.on_callback_query(filters.regex(r"^broadcast_"))
async def broadcast_callback(client, query: CallbackQuery):
    user_id = query.from_user.id
    bot_id = client.me.id
    data = query.data
    
    bot_ctx = get_bot_context(bot_id)
    allowed_owners = [OWNER_ID, bot_ctx.get("owner_id", OWNER_ID)]
    
    if user_id not in allowed_owners:
        return await query.answer("❌ Unauthorized!", show_alert=True)
    
    if not hasattr(client, 'broadcast_data') or user_id not in client.broadcast_data:
        return await query.answer("❌ Broadcast session expired!", show_alert=True)
    
    if "broadcast_no" in data:
        del client.broadcast_data[user_id]
        await query.message.edit_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Broadcast cancelled.</b>", parse_mode=ParseMode.HTML)
        return
    
    if "broadcast_yes" in data:
        broadcast_data = client.broadcast_data[user_id]
        targets = broadcast_data['targets']
        broadcast_msg = broadcast_data['message']
        broadcast_text = broadcast_data['text']
        
        total_targets = len(targets)
        success_count = 0
        fail_count = 0
        blocked_count = 0
        
        status_msg = await query.message.edit_text(
            f"<tg-emoji emoji-id='6300733352697661457'>📢</tg-emoji> <b>Broadcasting...</b>\n\n"
            f"<tg-emoji emoji-id='5462921117423384478'>📊</tg-emoji> <b>Progress:</b> <code>0/{total_targets}</code>\n"
            f"<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Success:</b> <code>0</code>\n"
            f"<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Failed:</b> <code>0</code>\n"
            f"<tg-emoji emoji-id='6158862632926319619'>🚫</tg-emoji> <b>Blocked:</b> <code>0</code>",
            parse_mode=ParseMode.HTML
        )
        
        for i, target_id in enumerate(targets):
            try:
                if broadcast_msg:
                    await broadcast_msg.copy(target_id)
                else:
                    await client.send_message(target_id, broadcast_text)
                
                success_count += 1
            except Exception as e:
                error_str = str(e).upper()
                if any(err in error_str for err in ["BLOCKED", "USER_IS_BLOCKED", "DELETED", "KICKED"]):
                    blocked_count += 1
                else:
                    fail_count += 1
                    logger.debug(f"Broadcast failed for {target_id}: {e}")
            
            if (i + 1) % 20 == 0:
                try:
                    await status_msg.edit_text(
                        f"<tg-emoji emoji-id='6300733352697661457'>📢</tg-emoji> <b>Broadcasting...</b>\n\n"
                        f"<tg-emoji emoji-id='5462921117423384478'>📊</tg-emoji> <b>Progress:</b> <code>{i + 1}/{total_targets}</code>\n"
                        f"<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Success:</b> <code>{success_count}</code>\n"
                        f"<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Failed:</b> <code>{fail_count}</code>\n"
                        f"<tg-emoji emoji-id='6158862632926319619'>🚫</tg-emoji> <b>Blocked:</b> <code>{blocked_count}</code>",
                        parse_mode=ParseMode.HTML
                    )
                except:
                    pass
            
            await asyncio.sleep(0.035)
        
        final_text = (
            f"<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Broadcast Complete!</b>\n\n"
            f"<tg-emoji emoji-id='5462921117423384478'>📊</tg-emoji> <b>Total Targets:</b> <code>{total_targets}</code>\n"
            f"<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>Success:</b> <code>{success_count}</code>\n"
            f"<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>Failed:</b> <code>{fail_count}</code>\n"
            f"<tg-emoji emoji-id='6158862632926319619'>🚫</tg-emoji> <b>Blocked/Deleted:</b> <code>{blocked_count}</code>"
        )
        
        await status_msg.edit_text(final_text, parse_mode=ParseMode.HTML)
        del client.broadcast_data[user_id]

@app.on_message(filters.command("users") & filters.private)
async def users_command(client, message):
    user_id = message.from_user.id
    bot_id = client.me.id
    
    bot_ctx = get_bot_context(bot_id)
    allowed_owners = [OWNER_ID, bot_ctx.get("owner_id", OWNER_ID)]
    
    if user_id not in allowed_owners:
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>This command is restricted to the bot owner only.</b>", parse_mode=ParseMode.HTML)
    
    users_count, chats_count = await get_stats_count(bot_id)
    
    await message.reply_text(
        f"<tg-emoji emoji-id='5462921117423384478'>📊</tg-emoji> <b>Statistics for this Bot</b>\n\n"
        f"<tg-emoji emoji-id='5972240522889138094'>👥</tg-emoji> <b>Users:</b> <code>{users_count}</code>\n"
        f"<tg-emoji emoji-id='6300733352697661457'>💬</tg-emoji> <b>Groups/Chats:</b> <code>{chats_count}</code>\n"
        f"<tg-emoji emoji-id='6158862632926319619'>🗄</tg-emoji> <b>Database Isolated:</b> <code>musicbot_{bot_id}</code>\n",
        parse_mode=ParseMode.HTML
    )

@app.on_message(filters.command(["active", "activebots"]) & filters.private)
async def active_command(client, message):
    user_id = message.from_user.id
    bot_id = client.me.id
    
    bot_ctx = get_bot_context(bot_id)
    allowed_owners = [OWNER_ID, bot_ctx.get("owner_id", OWNER_ID)]
    
    if user_id not in allowed_owners:
        return await message.reply_text("<tg-emoji emoji-id='5971944878815317190'>❌</tg-emoji> <b>This command is restricted to the bot owner only.</b>", parse_mode=ParseMode.HTML)
    
    active_bots_count = len(bot_registry)
    active_vcs_count = len(progress_tasks)
    
    await message.reply_text(
        f"<tg-emoji emoji-id='5462921117423384478'>📊</tg-emoji> <b>System Activity Status</b>\n\n"
        f"<tg-emoji emoji-id='5972240522889138094'>🤖</tg-emoji> <b>Active Hosted Bots:</b> <code>{active_bots_count}</code>\n"
        f"<tg-emoji emoji-id='5462921117423384478'>🎧</tg-emoji> <b>Live Voice Chats:</b> <code>{active_vcs_count}</code>",
        parse_mode=ParseMode.HTML
    )

# ─── PyTgCalls Event Handlers ─────────────────────────────────────────────

@call_py.on_update(fl.stream_end())
async def on_stream_end(client: PyTgCalls, update: StreamEnded):
    chat_id = update.chat_id
    
    bot_id = None
    for b_id, b_ctx in bot_registry.items():
        if b_ctx["call"] == client:
            bot_id = b_id
            break

    if not bot_id:
        if hasattr(app, "me") and app.me:
            bot_id = app.me.id

    if not bot_id: return

    q_key = (bot_id, chat_id)

    if q_key in progress_tasks:
        progress_tasks[q_key].cancel()
        del progress_tasks[q_key]

    if q_key in chat_queues:
        if chat_queues[q_key]:
            finished_song = chat_queues[q_key][0]
            if finished_song.get('file_path') and os.path.exists(finished_song['file_path']):
                try: os.remove(finished_song['file_path'])
                except: pass
            
            chat_queues[q_key].pop(0)
        
        if chat_queues[q_key]:
            next_song = chat_queues[q_key][0]
            await play_music_core(bot_id, chat_id, next_song)
        else:
            await register_chat(bot_id, chat_id)
            try: await client.leave_call(chat_id)
            except: pass

# ─── Callback & Admin Handlers ────────────────────────────────────────────

@app.on_callback_query()
async def callback_handler(client, query: CallbackQuery):
    data = query.data
    chat_id = query.message.chat.id
    user_id = query.from_user.id
    bot_id = client.me.id
    q_key = (bot_id, chat_id)
    ctx = get_bot_context(bot_id)

    if data == "progress":
        await query.answer("❄️ Live Playback")
        return

    if data == "show_help":
        buttons = [
            [InlineKeyboardButton("🎵 Music", callback_data="help_music", style="primary"),
             InlineKeyboardButton("🛡️ Admin", callback_data="help_admin", style="secondary")],
            [InlineKeyboardButton("🏠 Home", callback_data="go_back", style="success")]
        ]
        text = (
            "<blockquote><b><tg-emoji emoji-id='5971944878815317190'>💡</tg-emoji> ʙᴏᴛ ᴄᴏᴍᴍᴀɴᴅs ᴍᴇɴᴜ</b></blockquote>\n\n"
            "<i>Select a category below to explore the commands.</i>\n\n"
            "<b>🔧 Utility Commands:</b>\n"
            "❍ `/ping` - <i>Check bot latency and system stats</i>\n"
            "❍ `/speedtest` - <i>Run a server speedtest</i>\n"
            "❍ `/users` - <i>Check registered users & chats (Owner)</i>\n"
            "❍ `/broadcast` - <i>Send a message to all users (Owner)</i>"
        )
        await query.message.edit_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(buttons))
        return

    if data == "go_back":
        await start_handler(client, query.message)
        return

    if data == "help_music":
        text = (
            "<blockquote><b><tg-emoji emoji-id='6325413811033477368'>✨</tg-emoji> ᴍᴜsɪᴄ ᴄᴏᴍᴍᴀɴᴅs</b></blockquote>\n\n"
            "❍ `/play` or `/p` - <i>Play a song or add it to the queue</i>\n"
            "❍ `/stop` or `/end` - <i>Stop playback and leave VC</i>\n"
            "❍ `/skip` - <i>Skip the current track</i>\n"
            "❍ `/pause` - <i>Pause the playing stream</i>\n"
            "❍ `/resume` - <i>Resume the paused stream</i>\n"
            "❍ `/clear` or `/clean` - <i>Empty the entire queue</i>"
        )
        await query.message.edit_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Back", callback_data="show_help", style="secondary")]]))
        return

    if data == "help_admin":
        text = (
            "<blockquote><b><tg-emoji emoji-id='6158862632926319619'>🛡️</tg-emoji> ᴀᴅᴍɪɴ & ᴍᴏᴅᴇʀᴀᴛɪᴏɴ</b></blockquote>\n\n"
            "<i>(Reply to a user's message with these commands)</i>\n\n"
            "❍ `/kick` - <i>Kick the user from the group</i>\n"
            "❍ `/ban` - <i>Ban the user from the group</i>\n"
            "❍ `/unban` - <i>Unban the user</i>\n"
            "❍ `/mute` - <i>Restrict the user from sending messages</i>\n"
            "❍ `/unmute` - <i>Allow the user to send messages again</i>"
        )
        await query.message.edit_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Back", callback_data="show_help", style="secondary")]]))
        return

    if data in ["stop", "skip", "pause", "resume", "clear"]:
        if not await is_admin(bot_id, chat_id, user_id):
            return await query.answer("❌ Admin only!", show_alert=True)
        
        if data == "stop": await stop_command(client, query.message)
        elif data == "skip": await skip_command(client, query.message)
        elif data == "pause": await pause_command(client, query.message)
        elif data == "resume": await resume_command(client, query.message)
        elif data == "clear":
             if q_key in chat_queues and len(chat_queues[q_key]) > 0:
                 chat_queues[q_key] = []
                 if q_key in progress_tasks:
                     progress_tasks[q_key].cancel()
                     del progress_tasks[q_key]
                 try: await ctx["call"].leave_call(chat_id)
                 except: pass
                 await query.answer("🗑 Queue cleared & Playback stopped.")
                 await query.message.edit_text("<tg-emoji emoji-id='5462921117423384478'>🗑</tg-emoji> <b>Queue cleared & Playback stopped by admin.</b>", parse_mode=ParseMode.HTML)
                 await register_chat(bot_id, chat_id)
             else:
                 await query.answer("❌ Queue is already empty.")

        try: await query.answer()
        except: pass

# ─── Admin Tools ──────────────────────────────────────────────────────────

@app.on_message(filters.command("kick") & filters.group)
async def kick_user(c, m):
    if not await is_admin(c.me.id, m.chat.id, m.from_user.id): return
    if m.reply_to_message:
        await m.chat.ban_member(m.reply_to_message.from_user.id)
        await m.chat.unban_member(m.reply_to_message.from_user.id)
        await m.reply_text("<tg-emoji emoji-id='6158862632926319619'>👞</tg-emoji> <b>User Kicked successfully.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command("ban") & filters.group)
async def ban_user(c, m):
    if not await is_admin(c.me.id, m.chat.id, m.from_user.id): return
    if m.reply_to_message:
        await m.chat.ban_member(m.reply_to_message.from_user.id)
        await m.reply_text("<tg-emoji emoji-id='6158862632926319619'>⛔</tg-emoji> <b>User Banned successfully.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command("unban") & filters.group)
async def unban_user(c, m):
    if not await is_admin(c.me.id, m.chat.id, m.from_user.id): return
    if m.reply_to_message:
        await m.chat.unban_member(m.reply_to_message.from_user.id)
        await m.reply_text("<tg-emoji emoji-id='6325413811033477368'>✅</tg-emoji> <b>User Unbanned successfully.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command("mute") & filters.group)
async def mute_user(c, m):
    if not await is_admin(c.me.id, m.chat.id, m.from_user.id): return
    if m.reply_to_message:
        await m.chat.restrict_member(m.reply_to_message.from_user.id, ChatPermissions(can_send_messages=False))
        await m.reply_text("<tg-emoji emoji-id='6158862632926319619'>🔇</tg-emoji> <b>User Muted successfully.</b>", parse_mode=ParseMode.HTML)

@app.on_message(filters.command("unmute") & filters.group)
async def unmute_user(c, m):
    if not await is_admin(c.me.id, m.chat.id, m.from_user.id): return
    if m.reply_to_message:
        await m.chat.restrict_member(m.reply_to_message.from_user.id, ChatPermissions(can_send_messages=True))
        await m.reply_text("<tg-emoji emoji-id='6325413811033477368'>🔊</tg-emoji> <b>User Unmuted successfully.</b>", parse_mode=ParseMode.HTML)

# ─── Main Execution ───────────────────────────────────────────────────────

async def main():
    global ASSISTANT_ID
    logger.info(f"🚀 Initializing System with Instance ID: {INSTANCE_ID}")
    
    # 1. Connect to MongoDB to enable Distributed Locking
    await init_mongodb()
    
    # 2. Compete for Master Node Execution
    is_main = await claim_main_instance()
    
    if is_main:
        logger.info("✅ Acquired Master Node Lock! Starting Primary MusicBot & Assistant...")
        await app.start()
        await user_app.start()
        
        me = await user_app.get_me()
        ASSISTANT_ID = me.id
        logger.info(f"✅ Main Assistant ID: {ASSISTANT_ID}")
        
        bot_info = await app.get_me()
        try:
            main_bot_db = mongo_client[f"musicbot_{bot_info.id}"]
            await main_bot_db.users.create_index("user_id", unique=True)
            await main_bot_db.chats.create_index("chat_id", unique=True)
        except:
            pass
        
        await call_py.start()
        
        # Store Assistant Username/Name explicitly for dynamic manual add messages
        bot_registry[bot_info.id] = {
            "bot": app,
            "user": user_app,
            "call": call_py,
            "assistant_id": ASSISTANT_ID,
            "assistant_username": me.username,
            "assistant_name": me.first_name,
            "owner_id": OWNER_ID
        }
        
        logger.info(f"✅ Primary Bot Started: @{bot_info.username}")
    else:
        logger.info("⚠️ Primary Bot is running on another Dyno. Falling back into Worker Node Mode.")
    
    # 3. Start Distributed Handlers
    asyncio.create_task(bot_manager_task(is_main))

    app_web = web.Application()
    app_web.add_routes(routes)
    runner = web.AppRunner(app_web)
    await runner.setup()
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    logger.info(f"✅ Web Server API Started on port {port}")

    # Pyrogram's idle intercepts SIGINT, SIGTERM, SIGABRT cleanly, so when 
    # Heroku tells the container to shut down, idle() unblocks gracefully.
    await idle()
    
    # 4. Graceful Cleanup
    logger.info("Shutdown signal received! Starting graceful cleanup...")
    await app_web.cleanup()
    
    if is_main:
        try: await call_py.stop()
        except: pass
        try: await user_app.stop()
        except: pass
        try: await app.stop()
        except: pass
        
    for b_id, b_ctx in bot_registry.items():
        if not is_main or (hasattr(app, "me") and app.me and b_id != app.me.id):
            try:
                await b_ctx["call"].stop()
                await b_ctx["user"].stop()
                await b_ctx["bot"].stop()
            except:
                pass
                
    if mongo_client:
        if hosted_bots_collection is not None:
            try:
                # Instantly release all hosted bots assigned to this instance so another instance picks them up immediately
                await hosted_bots_collection.update_many(
                    {"assigned_to": INSTANCE_ID},
                    {"$set": {"assigned_to": None, "last_active": datetime.utcnow() - timedelta(days=1)}}
                )
                logger.info("✅ Released all hosted bots instantly.")
            except Exception as e:
                logger.error(f"Error releasing hosted bots: {e}")

        if is_main:
            try:
                db = mongo_client["musicbot_master"]
                # Instantly release the master lock
                await db["system_locks"].delete_one({"lock_name": "main_bot", "instance_id": INSTANCE_ID})
                logger.info("✅ Master lock released.")
            except: pass
            
        mongo_client.close()

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
