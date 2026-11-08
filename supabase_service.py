import os
import json
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client
from crypto_service import CryptoService

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "").strip()

_client: Client = None

def get_supabase_client() -> Client:
    global _client
    if _client is None:
        if SUPABASE_URL and SUPABASE_KEY:
            try:
                _client = create_client(SUPABASE_URL, SUPABASE_KEY)
            except Exception as e:
                print(f"[SupabaseService] Client initialization error: {e}")
    return _client

def is_supabase_enabled() -> bool:
    client = get_supabase_client()
    return client is not None

class SupabaseService:
    BUCKET_NAME = "vault-documents"

    @classmethod
    def ensure_bucket(cls):
        client = get_supabase_client()
        if not client:
            return
        try:
            buckets = [b.name for b in client.storage.list_buckets()]
            if cls.BUCKET_NAME not in buckets:
                client.storage.create_bucket(cls.BUCKET_NAME, options={"public": False})
                print(f"[SupabaseService] Created private storage bucket: {cls.BUCKET_NAME}")
        except Exception as e:
            print(f"[SupabaseService] Storage bucket check: {e}")

    # ========================== USERS ========================== #

    @classmethod
    def get_user_by_email(cls, email: str):
        client = get_supabase_client()
        if not client: return None
        res = client.table("users").select("*").eq("email", email.strip().lower()).execute()
        return res.data[0] if res.data else None

    @classmethod
    def get_user_by_id(cls, user_id: int):
        client = get_supabase_client()
        if not client: return None
        res = client.table("users").select("*").eq("id", user_id).execute()
        return res.data[0] if res.data else None

    @classmethod
    def create_user(cls, email: str, full_name: str, password_hash: str, pin_hash: str = None, avatar_url: str = None):
        client = get_supabase_client()
        if not client: return None
        payload = {
            "email": email.strip().lower(),
            "full_name": full_name.strip(),
            "password_hash": password_hash,
            "pin_hash": pin_hash,
            "avatar_url": avatar_url or "/static/assets/ada_header_avatar.png",
            "auto_lock_minutes": 5
        }
        res = client.table("users").insert(payload).execute()
        return res.data[0] if res.data else None

    @classmethod
    def update_user_pin(cls, user_id: int, pin_hash: str):
        client = get_supabase_client()
        if not client: return False
        client.table("users").update({"pin_hash": pin_hash}).eq("id", user_id).execute()
        return True

    @classmethod
    def update_user_settings(cls, user_id: int, auto_lock_minutes: int):
        client = get_supabase_client()
        if not client: return False
        client.table("users").update({"auto_lock_minutes": auto_lock_minutes}).eq("id", user_id).execute()
        return True

    @classmethod
    def update_user_profile(cls, user_id: int, updates: dict):
        """Updates user profile and credentials in Supabase PostgreSQL."""
        client = get_supabase_client()
        if not client: return None
        allowed = ["full_name", "email", "avatar_url", "auto_lock_minutes", "password_hash", "pin_hash"]
        payload = {k: v for k, v in updates.items() if k in allowed and v is not None}
        if not payload:
            return cls.get_user_by_id(user_id)
        res = client.table("users").update(payload).eq("id", user_id).execute()
        return res.data[0] if res.data else cls.get_user_by_id(user_id)

    # ======================== DOCUMENTS ======================== #

    @classmethod
    def get_documents(cls, user_id: int, category: str = None, search: str = None, filter_type: str = "all", sort_by: str = "newest"):
        client = get_supabase_client()
        if not client: return [], {}

        query = client.table("documents").select("*").eq("user_id", user_id)

        if category and category.lower() != "all":
            query = query.ilike("category", category)

        if filter_type == "favorites":
            query = query.eq("is_favorite", 1)

        res = query.execute()
        docs = res.data or []

        # In-memory search filtering for complex multi-column matching
        if search:
            term = search.lower().strip()
            docs = [d for d in docs if (
                term in (d.get("title") or "").lower() or
                term in (d.get("document_type") or "").lower() or
                term in (d.get("document_number") or "").lower() or
                term in (d.get("notes") or "").lower() or
                term in (d.get("country") or "").lower() or
                term in (d.get("tags") or "").lower()
            )]

        # Calculate expiration statuses and days remaining
        today = datetime.now().date()
        for d in docs:
            exp = d.get("expires_date")
            d["status"] = "Active"
            d["urgency"] = "normal"
            d["days_remaining"] = None
            if exp:
                try:
                    exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
                    delta = (exp_date - today).days
                    d["days_remaining"] = delta
                    if delta < 0:
                        d["status"] = "Expired"
                        d["urgency"] = "expired"
                    elif delta <= 1:
                        d["status"] = "Expires Tomorrow" if delta == 1 else "Expires Today"
                        d["urgency"] = "critical"
                    elif delta <= 7:
                        d["status"] = f"Expires in {delta}d"
                        d["urgency"] = "urgent"
                    elif delta <= 14:
                        d["status"] = f"Expires in {delta}d"
                        d["urgency"] = "warning"
                    elif delta <= 30:
                        d["status"] = f"Expires in {delta}d"
                        d["urgency"] = "notice"
                except Exception:
                    pass

        if filter_type == "expiring":
            docs = [d for d in docs if d["days_remaining"] is not None and 0 <= d["days_remaining"] <= 30]

        # Sorting
        if sort_by == "oldest":
            docs.sort(key=lambda x: x.get("created_at") or "")
        elif sort_by == "expiry":
            docs.sort(key=lambda x: (x.get("expires_date") is None, x.get("expires_date") or ""))
        elif sort_by == "title":
            docs.sort(key=lambda x: (x.get("title") or "").lower())
        else:
            docs.sort(key=lambda x: x.get("created_at") or "", reverse=True)

        # Category counts
        all_res = client.table("documents").select("category").eq("user_id", user_id).execute()
        cat_counts = {}
        for row in (all_res.data or []):
            c = row.get("category")
            if c:
                cat_counts[c] = cat_counts.get(c, 0) + 1

        return docs, cat_counts

    @classmethod
    def get_document_by_id(cls, doc_id: int, user_id: int = None):
        client = get_supabase_client()
        if not client: return None
        query = client.table("documents").select("*").eq("id", doc_id)
        if user_id is not None:
            query = query.eq("user_id", user_id)
        res = query.execute()
        if not res.data: return None
        d = res.data[0]
        # Append expiry calculations
        if d.get("expires_date"):
            try:
                exp_date = datetime.strptime(d["expires_date"], "%Y-%m-%d").date()
                delta = (exp_date - datetime.now().date()).days
                d["days_remaining"] = delta
                d["urgency"] = "expired" if delta < 0 else ("critical" if delta <= 1 else ("urgent" if delta <= 7 else ("warning" if delta <= 14 else "notice" if delta <= 30 else "normal")))
            except Exception:
                pass
        return d

    @classmethod
    def add_document(cls, user_id: int, metadata: dict, raw_file_bytes: bytes):
        client = get_supabase_client()
        if not client: return None

        # 1. Encrypt file in memory using AES-256 Fernet
        token = CryptoService.generate_secure_token(12)
        storage_path = f"enc_{token}.votly"
        ciphertext = CryptoService.encrypt_data(raw_file_bytes)
        sha256_hash = CryptoService.compute_sha256(raw_file_bytes)
        file_size = len(raw_file_bytes)

        # 2. Upload ciphertext blob to Supabase Storage
        client.storage.from_(cls.BUCKET_NAME).upload(
            path=storage_path,
            file=ciphertext,
            file_options={"content-type": "application/octet-stream", "upsert": "true"}
        )

        # 3. Insert metadata record in Supabase database
        payload = {
            "user_id": user_id,
            "title": metadata.get("title", "Untitled Document"),
            "category": metadata.get("category", "Identity"),
            "document_type": metadata.get("document_type", "Document"),
            "document_number": metadata.get("document_number"),
            "country": metadata.get("country"),
            "issued_date": metadata.get("issued_date"),
            "expires_date": metadata.get("expires_date"),
            "notes": metadata.get("notes"),
            "tags": metadata.get("tags"),
            "file_path": storage_path,
            "original_filename": metadata.get("original_filename", "document.bin"),
            "file_size": file_size,
            "mime_type": metadata.get("mime_type", "application/octet-stream"),
            "sha256_hash": sha256_hash,
            "is_client_encrypted": metadata.get("is_client_encrypted", 0),
            "is_favorite": 0
        }
        res = client.table("documents").insert(payload).execute()
        new_doc = res.data[0] if res.data else None

        if new_doc:
            cls.log_activity(user_id, new_doc["id"], "UPLOAD", f"Document '{new_doc['title']}' encrypted with AES-256 and stored in Supabase Cloud.")

        return new_doc

    @classmethod
    def update_document(cls, doc_id: int, user_id: int, updates: dict):
        client = get_supabase_client()
        if not client: return None
        allowed = ["title", "category", "document_type", "document_number", "country", "issued_date", "expires_date", "notes", "tags", "is_favorite"]
        payload = {k: v for k, v in updates.items() if k in allowed}
        payload["updated_at"] = datetime.now().isoformat()
        res = client.table("documents").update(payload).eq("id", doc_id).eq("user_id", user_id).execute()
        return res.data[0] if res.data else None

    @classmethod
    def delete_document(cls, doc_id: int, user_id: int):
        client = get_supabase_client()
        if not client: return False
        doc = cls.get_document_by_id(doc_id, user_id)
        if not doc: return False

        # Remove from Supabase Storage
        storage_path = doc.get("file_path")
        if storage_path:
            try:
                client.storage.from_(cls.BUCKET_NAME).remove([storage_path])
            except Exception as e:
                print(f"[SupabaseService] Storage delete note: {e}")

        # Delete database record
        client.table("documents").delete().eq("id", doc_id).eq("user_id", user_id).execute()
        cls.log_activity(user_id, None, "DELETE", f"Document '{doc['title']}' permanently shredded and purged from vault.")
        return True

    @classmethod
    def toggle_favorite(cls, doc_id: int, user_id: int):
        doc = cls.get_document_by_id(doc_id, user_id)
        if not doc: return None
        new_fav = 0 if doc.get("is_favorite") else 1
        return cls.update_document(doc_id, user_id, {"is_favorite": new_fav})

    @classmethod
    def download_and_decrypt_file(cls, storage_path: str) -> bytes:
        client = get_supabase_client()
        if not client: return None
        # Clean path if prefixed with local path
        filename = os.path.basename(storage_path)
        try:
            ciphertext = client.storage.from_(cls.BUCKET_NAME).download(filename)
            return CryptoService.decrypt_data(ciphertext)
        except Exception as e:
            # Fallback to local disk if file is not in cloud storage
            if os.path.exists(storage_path):
                return CryptoService.decrypt_file(storage_path)
            raise e

    # ========================== SHARES ========================== #

    @classmethod
    def create_share(cls, doc_id: int, user_id: int, hours: int = 24, pin_hash: str = None):
        client = get_supabase_client()
        if not client: return None
        from datetime import timedelta
        token = CryptoService.generate_secure_token(16)
        expires_at = (datetime.now() + timedelta(hours=hours)).isoformat()
        payload = {
            "document_id": doc_id,
            "user_id": user_id,
            "share_token": token,
            "pin_hash": pin_hash,
            "expires_at": expires_at,
            "view_count": 0,
            "max_views": 10
        }
        res = client.table("shares").insert(payload).execute()
        return res.data[0] if res.data else None

    @classmethod
    def get_share_by_token(cls, token: str):
        client = get_supabase_client()
        if not client: return None
        res = client.table("shares").select("*, documents(*)").eq("share_token", token).execute()
        if not res.data: return None
        share = res.data[0]
        # Attach joined document
        doc = share.get("documents")
        return share, doc

    @classmethod
    def get_user_shares(cls, user_id: int):
        client = get_supabase_client()
        if not client: return []
        res = client.table("shares").select("*, documents(title, category, document_type)").eq("user_id", user_id).execute()
        return res.data or []

    @classmethod
    def delete_share(cls, share_id: int, user_id: int):
        client = get_supabase_client()
        if not client: return False
        client.table("shares").delete().eq("id", share_id).eq("user_id", user_id).execute()
        return True

    # ====================== ACTIVITY LOGS ====================== #

    @classmethod
    def log_activity(cls, user_id: int, document_id: int, action: str, details: str):
        client = get_supabase_client()
        if not client: return
        payload = {
            "user_id": user_id,
            "document_id": document_id,
            "action": action,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        try:
            client.table("activity_logs").insert(payload).execute()
        except Exception as e:
            print(f"[SupabaseService] Activity log error: {e}")

    @classmethod
    def get_activity_logs(cls, user_id: int, limit: int = 50):
        client = get_supabase_client()
        if not client: return []
        res = client.table("activity_logs").select("*").eq("user_id", user_id).order("timestamp", desc=True).limit(limit).execute()
        return res.data or []

    # ====================== NOTIFICATIONS ====================== #

    @classmethod
    def create_notification(cls, user_id: int, doc_id: int, milestone: str, title: str, message: str, channel: str = "all"):
        client = get_supabase_client()
        if not client: return None
        payload = {
            "user_id": user_id,
            "document_id": doc_id,
            "milestone": milestone,
            "title": title,
            "message": message,
            "channel": channel,
            "is_read": 0
        }
        try:
            res = client.table("notifications").insert(payload).execute()
            return res.data[0] if res.data else None
        except Exception:
            return None

    @classmethod
    def get_notifications(cls, user_id: int, unread_only: bool = False, limit: int = 50):
        client = get_supabase_client()
        if not client: return []
        query = client.table("notifications").select("*, documents(title, category, document_number, expires_date)").eq("user_id", user_id)
        if unread_only:
            query = query.eq("is_read", 0)
        res = query.order("sent_at", desc=True).limit(limit).execute()
        return res.data or []

    @classmethod
    def get_unread_count(cls, user_id: int) -> int:
        client = get_supabase_client()
        if not client: return 0
        res = client.table("notifications").select("id", count="exact").eq("user_id", user_id).eq("is_read", 0).execute()
        return res.count or 0

    @classmethod
    def mark_notification_read(cls, notif_id: int, user_id: int):
        client = get_supabase_client()
        if not client: return False
        client.table("notifications").update({"is_read": 1}).eq("id", notif_id).eq("user_id", user_id).execute()
        return True

    @classmethod
    def mark_all_read(cls, user_id: int):
        client = get_supabase_client()
        if not client: return False
        client.table("notifications").update({"is_read": 1}).eq("user_id", user_id).execute()
        return True

    @classmethod
    def check_and_generate_expiration_notifications(cls):
        from email_service import EmailService
        client = get_supabase_client()
        if not client: return []

        res = client.table("documents").select("*, users(email, full_name)").neq("expires_date", "").not_.is_("expires_date", "null").execute()
        documents = res.data or []
        today = datetime.now().date()
        processed = []

        for doc in documents:
            exp_str = doc.get("expires_date")
            if not exp_str: continue
            try:
                exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
            except Exception:
                continue

            delta_days = (exp_date - today).days
            milestone = None
            milestone_label = None

            if 25 <= delta_days <= 30:
                milestone = "30_DAYS"
                milestone_label = "1-Month Advance Notice"
            elif 11 <= delta_days <= 14:
                milestone = "14_DAYS"
                milestone_label = "2-Week Expiration Notice"
            elif 5 <= delta_days <= 7:
                milestone = "7_DAYS"
                milestone_label = "1-Week Urgent Warning"
            elif 0 <= delta_days <= 1:
                milestone = "1_DAY"
                milestone_label = "Final 24-Hour Notice"
            elif delta_days < 0:
                milestone = "EXPIRED"
                milestone_label = "Document Expired"

            if milestone:
                user_info = doc.get("users") or {}
                user_email = user_info.get("email") or "ada.okafor@email.com"
                user_name = user_info.get("full_name") or "Ada Okafor"

                title = f"{milestone_label}: '{doc['title']}'"
                if delta_days >= 0:
                    message = f"Your document '{doc['title']}' ({doc.get('document_type')}) expires in {delta_days} day{'s' if delta_days != 1 else ''} on {exp_str}."
                else:
                    message = f"Your document '{doc['title']}' expired {abs(delta_days)} day{'s' if abs(delta_days) != 1 else ''} ago on {exp_str}."

                notif = cls.create_notification(
                    user_id=doc["user_id"],
                    doc_id=doc["id"],
                    milestone=milestone,
                    title=title,
                    message=message
                )

                if notif:
                    email_result = EmailService.send_notification(
                        to_email=user_email,
                        user_name=user_name,
                        doc_title=doc["title"],
                        doc_number=doc.get("document_number"),
                        category=doc.get("category"),
                        expires_date=exp_str,
                        days_remaining=delta_days,
                        milestone_label=milestone_label
                    )
                    cls.log_activity(
                        doc["user_id"],
                        doc["id"],
                        "ALERT_SENT",
                        f"Automated {milestone_label} dispatched to {user_email}."
                    )
                    processed.append({
                        "document_id": doc["id"],
                        "title": doc["title"],
                        "milestone": milestone,
                        "days_remaining": delta_days,
                        "email_dispatched": email_result.get("success", False)
                    })

        return processed
