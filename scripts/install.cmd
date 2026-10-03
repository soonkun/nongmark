@echo off
rem Nongmark setup: asks all-users (Program Files, UAC) or current-user (%LOCALAPPDATA%\Programs\Nongmark), desktop shortcut; registers .md files and an Apps & features entry.
"%~dp0nongmark.exe" --install
