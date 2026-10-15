import os
import base64
import hashlib
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Generate or load persistent server vault master key
MASTER_KEY_FILE = "vault_master.key"

def get_or_create_master_key():
    if os.path.exists(MASTER_KEY_FILE):
        with open(MASTER_KEY_FILE, "rb") as f:
            return f.read().strip()
    key = Fernet.generate_key()
    with open(MASTER_KEY_FILE, "wb") as f:
        f.write(key)
    return key

MASTER_KEY = get_or_create_master_key()
fernet = Fernet(MASTER_KEY)

class CryptoService:
    @staticmethod
    def encrypt_data(data: bytes) -> bytes:
        """
        Encrypt raw bytes using Fernet (AES-128-CBC + HMAC-SHA256 authenticated encryption)
        or AES-256-GCM.
        """
        return fernet.encrypt(data)

    @staticmethod
    def decrypt_data(token: bytes) -> bytes:
        """
        Decrypt encrypted data bytes.
        """
        return fernet.decrypt(token)

    @staticmethod
    def encrypt_file(input_bytes: bytes, output_path: str):
        """
        Encrypts in-memory file bytes and writes ciphertext to output_path.
        """
        encrypted = fernet.encrypt(input_bytes)
        with open(output_path, "wb") as f:
            f.write(encrypted)
        return len(encrypted)

    @staticmethod
    def decrypt_file(input_path: str) -> bytes:
        """
        Reads ciphertext from input_path and returns decrypted raw bytes.
        """
        with open(input_path, "rb") as f:
            ciphertext = f.read()
        return fernet.decrypt(ciphertext)

    @staticmethod
    def compute_sha256(data: bytes) -> str:
        """
        Computes cryptographic SHA-256 fingerprint of the data.
        """
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def generate_secure_token(length: int = 32) -> str:
        """
        Generates a URL-safe cryptographically secure random token.
        """
        return base64.urlsafe_b64encode(os.urandom(length)).decode('utf-8').rstrip('=')
