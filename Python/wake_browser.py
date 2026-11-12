#!/usr/bin/env python3
"""
wake_browser.py - Cross-Platform Chrome Enterprise Core (CEC / CBCM) Browser Waker

Purpose:
    Temporarily launches a system-installed Google Chrome instance using an isolated,
    ephemeral profile directory so newly imaged or unattended endpoints can:
      1. Register with Chrome Enterprise Core via CloudManagementEnrollmentToken, and/or
      2. Fetch updated cloud policies and upload browser/extension telemetry.

Key Safeguards:
    - 100% Python Standard Library (zero third-party pip dependencies).
    - Cross-platform support: Windows, macOS, and Linux.
    - Aborts cleanly if Chrome is already running under the SAME user (exact Windows SID
      or POSIX numeric UID check—never fragile username regex matching).
    - Strictly enforces system-level Chrome installations (Program Files on Windows,
      /Applications on macOS, /opt or /usr on Linux) and rejects user-folder installs.
    - Flags (logs a WARNING) if no CloudManagementEnrollmentToken is present on the host,
      but still launches Chrome as requested so existing enrolled browsers can check in.
    - Terminates ONLY the exact spawned Chrome process tree (never other users' browsers)
      and securely removes the temporary profile directory in a guaranteed finally block.

Exit Codes:
    0 - Success (wake cycle completed, or skipped because same-user Chrome is already running)
    2 - System-level Google Chrome installation not found (or failed signature/ownership check)
    3 - Unsupported operating system or failed user-identity pre-flight check
    4 - Chrome failed to launch or exited prematurely with an error
"""

from __future__ import annotations

import argparse
import ctypes
import glob
import json
import logging
import os
import platform
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import List, Optional, Tuple

EXIT_SUCCESS = 0
EXIT_NO_SYSTEM_CHROME = 2
EXIT_PREFLIGHT_ERROR = 3
EXIT_LAUNCH_FAILURE = 4


# ---------------------------------------------------------------------------
# Logging Setup
# ---------------------------------------------------------------------------

def setup_logger(log_file: Optional[str] = None, verbose: bool = False) -> logging.Logger:
    """Configure console + optional file logging with safe fallback if CWD is read-only."""
    logger = logging.getLogger("WakeBrowser")
    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    )
    logger.addHandler(console_handler)

    target_log = log_file or "wake_browser.log"
    file_handler = None
    for candidate in (Path(target_log), Path(tempfile.gettempdir()) / Path(target_log).name):
        try:
            file_handler = logging.FileHandler(candidate, encoding="utf-8")
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(
                logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
            )
            logger.addHandler(file_handler)
            logger.debug("Logging detailed output to: %s", candidate.resolve())
            break
        except OSError:
            continue

    return logger


# ---------------------------------------------------------------------------
# Requirement #2: Strict System-Level Chrome Binary Resolution
# ---------------------------------------------------------------------------

def _verify_windows_signature(chrome_path: Path, logger: logging.Logger) -> bool:
    """Verify Authenticode signature on Windows before executing Chrome (especially as SYSTEM)."""
    ps_exe = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
    if not ps_exe:
        logger.debug("PowerShell not found; skipping Authenticode check.")
        return True

    escaped_path = str(chrome_path).replace("'", "''")
    cmd = [
        ps_exe,
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        (
            f"$sig = Get-AuthenticodeSignature -LiteralPath '{escaped_path}'; "
            "if ($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'Google') "
            "{ exit 0 } else { Write-Output $sig.Status; exit 1 }"
        ),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15, check=False)
        if res.returncode == 0:
            logger.debug("Verified valid Google Authenticode signature on %s", chrome_path)
            return True
        logger.error(
            "Authenticode verification failed for %s (status: %s)",
            chrome_path,
            res.stdout.strip() or res.stderr.strip(),
        )
        return False
    except Exception as exc:
        logger.warning("Could not run Authenticode signature check (%s); proceeding.", exc)
        return True


def _verify_macos_signature(app_bundle: Path, logger: logging.Logger) -> bool:
    """Verify macOS code signature on /Applications/Google Chrome.app."""
    codesign_bin = "/usr/bin/codesign"
    if not os.path.exists(codesign_bin):
        return True

    try:
        res = subprocess.run(
            [codesign_bin, "--verify", "--strict", str(app_bundle)],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if res.returncode == 0:
            logger.debug("Verified valid macOS code signature on %s", app_bundle)
            return True
        logger.error(
            "macOS codesign verification failed for %s: %s",
            app_bundle,
            res.stderr.strip(),
        )
        return False
    except Exception as exc:
        logger.warning("Could not run codesign check (%s); proceeding.", exc)
        return True


def find_system_chrome(
    os_name: str,
    logger: logging.Logger,
    skip_signature_check: bool = False,
) -> Optional[Path]:
    """
    Locate Google Chrome strictly inside OS system application directories.
    User-profile application directories (%LOCALAPPDATA%, ~/Applications, /home) are
    explicitly excluded and logged if encountered when system Chrome is missing.
    """
    if os_name == "Windows":
        # Include ProgramW6432 first so 32-bit Python on 64-bit Windows still checks C:\Program Files
        roots = [
            os.environ.get("ProgramW6432"),
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ]
        seen = set()
        system_candidates: List[Path] = []
        for root in roots:
            if not root:
                continue
            norm = os.path.normcase(os.path.abspath(root))
            if norm not in seen:
                seen.add(norm)
                system_candidates.append(Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe")

        for candidate in system_candidates:
            if candidate.is_file():
                resolved = candidate.resolve()
                # Guard against junctions pointing into C:\Users
                if "\\users\\" in str(resolved).lower():
                    logger.error("Rejected %s because it resolves into a user directory (%s).", candidate, resolved)
                    continue
                if not skip_signature_check and not _verify_windows_signature(resolved, logger):
                    return None
                return resolved

        # Diagnostic check: report clearly if only a user-level install exists
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            user_chrome = Path(local_app_data) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if user_chrome.is_file():
                logger.error(
                    "Detected user-level Chrome installation at '%s', which is disallowed. "
                    "Chrome must be installed in a system Program Files directory.",
                    user_chrome,
                )
        return None

    if os_name == "Darwin":
        app_bundle = Path("/Applications/Google Chrome.app")
        chrome_bin = app_bundle / "Contents" / "MacOS" / "Google Chrome"

        if chrome_bin.is_file() and os.access(chrome_bin, os.X_OK):
            resolved = chrome_bin.resolve()
            if str(resolved).startswith("/Users/"):
                logger.error(
                    "Rejected %s because it resolves into a user directory (%s).",
                    chrome_bin,
                    resolved,
                )
                return None
            if not skip_signature_check and not _verify_macos_signature(app_bundle, logger):
                return None
            return resolved

        user_app = Path.home() / "Applications" / "Google Chrome.app"
        if user_app.exists():
            logger.error(
                "Detected user-level Chrome installation at '%s', which is disallowed. "
                "Chrome must be installed in '/Applications/Google Chrome.app'.",
                user_app,
            )
        return None

    if os_name == "Linux":
        system_candidates = [
            Path("/opt/google/chrome/chrome"),
            Path("/usr/bin/google-chrome-stable"),
            Path("/usr/bin/google-chrome"),
        ]
        for candidate in system_candidates:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                resolved = candidate.resolve()
                if not (str(resolved).startswith("/opt/") or str(resolved).startswith("/usr/")):
                    logger.error(
                        "Rejected %s because it resolves outside /opt or /usr (%s).",
                        candidate,
                        resolved,
                    )
                    continue
                try:
                    st = os.stat(resolved)
                    if st.st_uid != 0:
                        logger.error(
                            "Rejected %s because binary is not owned by root (uid=%d).",
                            resolved,
                            st.st_uid,
                        )
                        continue
                except OSError as exc:
                    logger.error("Failed to stat %s: %s", resolved, exc)
                    continue
                return resolved
        return None

    return None


# ---------------------------------------------------------------------------
# Requirement #1: Same-User Running Chrome Process Detection
# ---------------------------------------------------------------------------

def _get_windows_same_user_chrome_pids(logger: logging.Logger) -> Tuple[str, List[int]]:
    """
    Return (current_sid, [matching_chrome_pids]) on Windows using native Win32 APIs via ctypes.
    Compares exact Security Identifiers (e.g., S-1-5-18 for SYSTEM) so localized account names
    or usernames containing 'system' never cause false matches.
    """
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    TOKEN_QUERY = 0x0008
    TokenUser = 1
    TH32CS_SNAPPROCESS = 0x00000002
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    class SID_AND_ATTRIBUTES(ctypes.Structure):
        _fields_ = [
            ("Sid", ctypes.c_void_p),
            ("Attributes", wintypes.DWORD),
        ]

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * wintypes.MAX_PATH),
        ]

    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL

    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL

    def get_process_sid(proc_handle: int) -> Optional[str]:
        token_handle = wintypes.HANDLE()
        if not advapi32.OpenProcessToken(proc_handle, TOKEN_QUERY, ctypes.byref(token_handle)):
            return None
        try:
            needed = wintypes.DWORD(0)
            advapi32.GetTokenInformation(token_handle, TokenUser, None, 0, ctypes.byref(needed))
            if needed.value == 0:
                return None
            buf = ctypes.create_string_buffer(needed.value)
            if not advapi32.GetTokenInformation(
                token_handle, TokenUser, buf, needed.value, ctypes.byref(needed)
            ):
                return None
            sid_attr = ctypes.cast(buf, ctypes.POINTER(SID_AND_ATTRIBUTES)).contents
            str_ptr = ctypes.c_void_p()
            if not advapi32.ConvertSidToStringSidW(sid_attr.Sid, ctypes.byref(str_ptr)):
                return None
            try:
                return ctypes.wstring_at(str_ptr.value)
            finally:
                kernel32.LocalFree(str_ptr)
        finally:
            kernel32.CloseHandle(token_handle)

    current_sid = get_process_sid(kernel32.GetCurrentProcess())
    if not current_sid:
        raise RuntimeError("Unable to determine current Windows process SID.")

    matching_pids: List[int] = []
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE_VALUE or not snap:
        raise RuntimeError("CreateToolhelp32Snapshot failed.")

    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        has_item = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while has_item:
            if entry.szExeFile.lower() == "chrome.exe":
                pid = int(entry.th32ProcessID)
                proc_handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                if proc_handle:
                    try:
                        proc_sid = get_process_sid(proc_handle)
                        if proc_sid == current_sid:
                            matching_pids.append(pid)
                    finally:
                        kernel32.CloseHandle(proc_handle)
            has_item = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)

    logger.debug("Windows SID check: current_sid=%s, same_user_chrome_pids=%s", current_sid, matching_pids)
    return current_sid, matching_pids


def find_same_user_chrome_pids(os_name: str, logger: logging.Logger) -> Tuple[str, List[int]]:
    """
    Check if Google Chrome is currently running under the same user account/SID
    that is executing this script.
    Returns (user_identity_label, list_of_matching_pids).
    """
    if os_name == "Windows":
        return _get_windows_same_user_chrome_pids(logger)

    uid = os.getuid()
    identity = f"uid={uid}"

    if os_name == "Darwin":
        res = subprocess.run(
            ["/bin/ps", "-u", str(uid), "-o", "pid=,comm="],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if res.returncode not in (0, 1):
            raise RuntimeError(f"ps command failed with code {res.returncode}: {res.stderr.strip()}")

        pids: List[int] = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) != 2:
                continue
            pid_str, comm = parts
            exe_name = os.path.basename(comm.strip())
            if exe_name == "Google Chrome":
                try:
                    pids.append(int(pid_str))
                except ValueError:
                    continue
        return identity, pids

    if os_name == "Linux":
        pids = []
        proc_root = Path("/proc")
        if proc_root.is_dir():
            for entry in proc_root.iterdir():
                if not entry.name.isdigit():
                    continue
                try:
                    status_text = (entry / "status").read_text(encoding="utf-8", errors="replace")
                    proc_uid = None
                    proc_name = ""
                    for line in status_text.splitlines():
                        if line.startswith("Name:"):
                            proc_name = line.split(":", 1)[1].strip()
                        elif line.startswith("Uid:"):
                            proc_uid = int(line.split()[1])
                            break
                    if proc_uid == uid and proc_name in ("chrome", "google-chrome", "google-chrome-stable"):
                        pids.append(int(entry.name))
                except (OSError, ValueError):
                    continue
            return identity, pids

    raise RuntimeError(f"Unsupported platform for process inspection: {os_name}")


# ---------------------------------------------------------------------------
# Enrollment Token & DMToken Inspection (Logs Warning if Token Missing)
# ---------------------------------------------------------------------------

def _mask_token(token: str) -> str:
    token = token.strip()
    if len(token) <= 8:
        return "****"
    return f"{token[:4]}...{token[-4:]}"


def check_enrollment_token(os_name: str, logger: logging.Logger) -> Optional[Tuple[str, str]]:
    """
    Inspect standard machine-level CloudManagementEnrollmentToken locations.
    Returns (source_location, token_value) if found, or None if missing.
    """
    if os_name == "Windows":
        import winreg

        reg_views = (
            winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0),
            winreg.KEY_READ | getattr(winreg, "KEY_WOW64_32KEY", 0),
        )
        reg_locations = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Google\Chrome", "CloudManagementEnrollmentToken"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Google\Chrome", "CloudManagementEnrollmentToken"),
            (
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Google\Update\ClientState\{8A69D345-D564-463c-AFF1-A69D9E530F96}",
                "CloudManagementEnrollmentToken",
            ),
        ]
        for hive, subkey, value_name in reg_locations:
            for access_mask in reg_views:
                try:
                    with winreg.OpenKey(hive, subkey, 0, access_mask) as key:
                        val, _ = winreg.QueryValueEx(key, value_name)
                        if isinstance(val, str) and val.strip():
                            return (f"HKLM\\{subkey}\\{value_name}", val.strip())
                except OSError:
                    continue
        return None

    if os_name == "Darwin":
        plist_paths = [
            Path("/Library/Managed Preferences/com.google.Chrome.plist"),
            Path("/Library/Preferences/com.google.Chrome.plist"),
        ]
        for plist_path in plist_paths:
            if plist_path.is_file():
                try:
                    with plist_path.open("rb") as fp:
                        data = plistlib.load(fp)
                    token = data.get("CloudManagementEnrollmentToken")
                    if isinstance(token, str) and token.strip():
                        return (str(plist_path), token.strip())
                except Exception as exc:
                    logger.debug("Could not parse %s: %s", plist_path, exc)

        token_file = Path("/Library/Google/Chrome/CloudManagementEnrollmentToken")
        if token_file.is_file():
            try:
                token = token_file.read_text(encoding="utf-8").strip()
                if token:
                    return (str(token_file), token)
            except OSError as exc:
                logger.debug("Could not read %s: %s", token_file, exc)
        return None

    if os_name == "Linux":
        for json_file in sorted(glob.glob("/etc/opt/chrome/policies/managed/*.json")):
            try:
                data = json.loads(Path(json_file).read_text(encoding="utf-8"))
                token = data.get("CloudManagementEnrollmentToken")
                if isinstance(token, str) and token.strip():
                    return (json_file, token.strip())
            except Exception as exc:
                logger.debug("Could not parse %s: %s", json_file, exc)

        token_file = Path("/etc/opt/chrome/policies/enrollment/CloudManagementEnrollmentToken")
        if token_file.is_file():
            try:
                token = token_file.read_text(encoding="utf-8").strip()
                if token:
                    return (str(token_file), token)
            except OSError as exc:
                logger.debug("Could not read %s: %s", token_file, exc)
        return None

    return None


def has_dmtoken(os_name: str) -> bool:
    """Check whether a machine-level Chrome Enterprise Core DMToken is stored on disk/registry."""
    if os_name == "Windows":
        import winreg

        reg_views = (
            winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0),
            winreg.KEY_READ | getattr(winreg, "KEY_WOW64_32KEY", 0),
        )
        enrollment_roots = [
            r"SOFTWARE\Google\Enrollment",
            r"SOFTWARE\Google\Chrome\Enrollment",
        ]
        for root_path in enrollment_roots:
            for access_mask in reg_views:
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, root_path, 0, access_mask) as root_key:
                        # Check direct dmtoken value
                        try:
                            val, _ = winreg.QueryValueEx(root_key, "dmtoken")
                            if val:
                                return True
                        except OSError:
                            pass
                        # Check subkeys (GUID subkeys under SOFTWARE\Google\Enrollment)
                        idx = 0
                        while True:
                            try:
                                sub_name = winreg.EnumKey(root_key, idx)
                                idx += 1
                                with winreg.OpenKey(root_key, sub_name, 0, access_mask) as sub_key:
                                    val, _ = winreg.QueryValueEx(sub_key, "dmtoken")
                                    if val:
                                        return True
                            except OSError:
                                break
                except OSError:
                    continue
        return False

    if os_name == "Darwin":
        for dmtoken_path in (
            Path("/Library/Application Support/Google/CloudManagement"),
            Path("/Library/Application Support/Google/Chrome Cloud Management"),
        ):
            try:
                if dmtoken_path.is_file() and dmtoken_path.stat().st_size > 0:
                    return True
                if dmtoken_path.is_dir() and any(
                    p.is_file() and p.stat().st_size > 0 for p in dmtoken_path.iterdir()
                ):
                    return True
            except OSError:
                continue
        return False

    if os_name == "Linux":
        enrollment_dir = Path("/etc/opt/chrome/policies/enrollment")
        if enrollment_dir.is_dir():
            try:
                for p in enrollment_dir.iterdir():
                    if (
                        p.is_file()
                        and p.name != "CloudManagementEnrollmentToken"
                        and p.stat().st_size > 0
                    ):
                        return True
            except OSError:
                pass
        for candidate_dir in (Path("/opt/google/chrome"), Path("/var/lib/google/chrome")):
            if candidate_dir.is_dir():
                for p in candidate_dir.rglob("*dmtoken*"):
                    try:
                        if p.is_file() and p.stat().st_size > 0:
                            return True
                    except OSError:
                        continue
        return False

    return False


# ---------------------------------------------------------------------------
# Process Launch, Scoped Termination & Secure Temp Cleanup
# ---------------------------------------------------------------------------

def terminate_spawned_browser(
    proc: subprocess.Popen,
    os_name: str,
    grace_seconds: int,
    logger: logging.Logger,
) -> None:
    """
    Terminate ONLY the exact Chrome process tree spawned by this script.
    Never kills Chrome processes belonging to other users or sessions.
    """
    if proc.poll() is not None:
        logger.debug("Spawned Chrome process (PID %d) has already exited.", proc.pid)
        return

    logger.info("Stopping temporary Chrome instance (root PID %d)...", proc.pid)

    if os_name == "Windows":
        taskkill = shutil.which("taskkill.exe") or "taskkill.exe"
        # Attempt graceful tree termination first
        subprocess.run(
            [taskkill, "/PID", str(proc.pid), "/T"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        deadline = time.monotonic() + max(1, grace_seconds // 2)
        while time.monotonic() < deadline and proc.poll() is None:
            time.sleep(0.5)

        if proc.poll() is None:
            logger.debug("Graceful close timed out; forcing termination of PID %d tree.", proc.pid)
            subprocess.run(
                [taskkill, "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        return

    # POSIX (macOS / Linux): signal dedicated process group created via start_new_session=True
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError as exc:
        logger.debug("killpg(SIGTERM) failed (%s); falling back to proc.terminate().", exc)
        proc.terminate()

    deadline = time.monotonic() + max(1, grace_seconds)
    while time.monotonic() < deadline and proc.poll() is None:
        time.sleep(0.5)

    if proc.poll() is None:
        logger.debug("Graceful SIGTERM timed out; sending SIGKILL to process group %d.", proc.pid)
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            proc.kill()

    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def cleanup_temp_profile(temp_dir: Path, logger: logging.Logger) -> None:
    """Remove temporary user-data-dir with brief retries for lingering file locks (e.g. AV/Defender)."""
    if not temp_dir.exists():
        return

    for attempt in range(1, 6):
        try:
            shutil.rmtree(temp_dir)
            logger.info("Cleaned up temporary Chrome profile directory: %s", temp_dir)
            return
        except OSError as exc:
            if attempt == 5:
                logger.warning(
                    "Could not completely remove temporary profile directory '%s' after 5 attempts: %s",
                    temp_dir,
                    exc,
                )
            else:
                logger.debug("Retry %d/5 waiting for file locks on %s (%s)...", attempt, temp_dir, exc)
                time.sleep(2)


# ---------------------------------------------------------------------------
# Main Workflow
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cross-platform Chrome Enterprise Core (CEC/CBCM) browser wake utility."
    )
    parser.add_argument(
        "--wait-seconds",
        type=int,
        default=45,
        help="Seconds to keep Chrome running for enrollment & telemetry upload (default: 45).",
    )
    parser.add_argument(
        "--shutdown-grace-seconds",
        type=int,
        default=10,
        help="Seconds to wait for graceful browser exit before force-killing (default: 10).",
    )
    parser.add_argument(
        "--profile-name",
        default="CECProfile",
        help="Temporary Chrome profile directory name (default: CECProfile).",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Pass --headless=new to Chrome (optional; auto-enabled on GUI-less Linux).",
    )
    parser.add_argument(
        "--skip-signature-check",
        action="store_true",
        help="Skip OS binary signature verification on Chrome executable.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run all pre-flight checks (system install, same-user process, token) without launching Chrome.",
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Path to log file (default: ./wake_browser.log, falling back to system temp dir).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose DEBUG logging to stdout.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logger = setup_logger(log_file=args.log_file, verbose=args.verbose)

    os_name = platform.system()
    logger.info("Starting Chrome Wake check on %s (%s)...", os_name, platform.release())

    if os_name not in ("Windows", "Darwin", "Linux"):
        logger.error("Unsupported operating system: %s", os_name)
        return EXIT_PREFLIGHT_ERROR

    # 1. Verify system-level Chrome installation (rejects user-folder installs)
    chrome_bin = find_system_chrome(
        os_name=os_name,
        logger=logger,
        skip_signature_check=args.skip_signature_check,
    )
    if not chrome_bin:
        logger.error(
            "Aborting: System-level Google Chrome installation was not found in standard OS "
            "application directories."
        )
        return EXIT_NO_SYSTEM_CHROME
    logger.info("Verified system-level Chrome binary: %s", chrome_bin)

    # 2. Check for CloudManagementEnrollmentToken (flag/log WARNING if absent, do NOT skip launch)
    token_info = check_enrollment_token(os_name, logger)
    if token_info:
        token_source, token_val = token_info
        logger.info(
            "Detected CloudManagementEnrollmentToken at '%s' (%s).",
            token_source,
            _mask_token(token_val),
        )
    else:
        logger.warning(
            "FLAG: No CloudManagementEnrollmentToken was found in machine policy locations! "
            "Browser launch will NOT be skipped on this basis (existing enrolled browsers can "
            "still sync policies and telemetry)."
        )

    had_dmtoken_before = has_dmtoken(os_name)
    logger.debug("Pre-launch DMToken present on machine: %s", had_dmtoken_before)

    # 3. Abort if Chrome is already running under the SAME user (SID / UID)
    try:
        user_identity, running_pids = find_same_user_chrome_pids(os_name, logger)
    except Exception as exc:
        logger.error("Failed to inspect running Chrome processes for current user: %s", exc)
        return EXIT_PREFLIGHT_ERROR

    if running_pids:
        logger.info(
            "Chrome is already running under the current user (%s, PIDs: %s). "
            "Skipping browser launch.",
            user_identity,
            running_pids,
        )
        return EXIT_SUCCESS
    logger.info("No existing Chrome processes detected for current user (%s).", user_identity)

    if args.dry_run:
        logger.info("Dry-run complete: all pre-flight checks passed; skipping Chrome execution.")
        return EXIT_SUCCESS

    # 4. Create isolated temporary user-data-dir (0700 permissions) & launch Chrome
    temp_user_data_dir = Path(tempfile.mkdtemp(prefix="cec_wake_profile_")).resolve()
    proc: Optional[subprocess.Popen] = None

    try:
        chrome_args = [
            str(chrome_bin),
            f"--user-data-dir={temp_user_data_dir}",
            f"--profile-directory={args.profile_name}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            "--disable-gpu",
        ]

        if os_name == "Windows":
            # Prevent Chromium's Windows UAC auto-de-elevation (RunDeElevated) when run from an
            # elevated Administrator prompt, which otherwise spawns a detached chrome.exe under
            # explorer.exe and exits our tracked parent PID after ~2s with exit code 0.
            chrome_args.append("--do-not-de-elevate")

        use_headless = args.headless
        if os_name == "Linux":
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                # Chromium refuses to start as root on Linux without --no-sandbox
                chrome_args.append("--no-sandbox")
            if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY") and not use_headless:
                logger.info("No DISPLAY/WAYLAND_DISPLAY detected on Linux; enabling --headless=new.")
                use_headless = True

        if use_headless:
            chrome_args.append("--headless=new")

        chrome_args.append("about:blank")

        popen_kwargs = {
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "stdin": subprocess.DEVNULL,
        }
        if os_name == "Windows":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True

        logger.info(
            "Launching Chrome with temporary profile '%s' (waiting %ds)...",
            temp_user_data_dir,
            args.wait_seconds,
        )
        logger.debug("Chrome command: %s", chrome_args)
        proc = subprocess.Popen(chrome_args, **popen_kwargs)

        # 5. Monitor browser health and DMToken creation during wake window
        dmtoken_logged = False
        start_time = time.monotonic()
        while (time.monotonic() - start_time) < args.wait_seconds:
            exit_code = proc.poll()
            if exit_code is not None:
                logger.error(
                    "Chrome exited prematurely after %.1fs with exit code %d.",
                    time.monotonic() - start_time,
                    exit_code,
                )
                return EXIT_LAUNCH_FAILURE

            if not had_dmtoken_before and not dmtoken_logged and has_dmtoken(os_name):
                logger.info(
                    "New Chrome Enterprise Core DMToken detected after %.1fs! "
                    "Continuing wake window so initial policy & telemetry sync completes.",
                    time.monotonic() - start_time,
                )
                dmtoken_logged = True

            time.sleep(1)

        logger.info("Wake duration (%ds) completed.", args.wait_seconds)
        return EXIT_SUCCESS

    except Exception as exc:
        logger.error("Unexpected error while launching/monitoring Chrome: %s", exc)
        return EXIT_LAUNCH_FAILURE

    finally:
        if proc is not None:
            terminate_spawned_browser(
                proc=proc,
                os_name=os_name,
                grace_seconds=args.shutdown_grace_seconds,
                logger=logger,
            )
        # Allow brief OS settle window before unlinking profile files
        time.sleep(2)
        cleanup_temp_profile(temp_user_data_dir, logger)


if __name__ == "__main__":
    sys.exit(main())
