@echo off
rem Nongmark: removes the .md file association added by install.cmd (current user only).
"%~dp0nongmark.exe" --uninstall
