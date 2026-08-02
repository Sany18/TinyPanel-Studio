#!/usr/bin/env python3
"""Small non-interactive serial reader for Device Studio."""

import signal
import sys
import time

import serial


running = True


def stop(_signum, _frame):
    global running
    running = False


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: serial_monitor.py PORT BAUD")
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    with serial.Serial(sys.argv[1], int(sys.argv[2]), timeout=0.2) as port:
        while running:
            data = port.read(port.in_waiting or 1)
            if data:
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            else:
                time.sleep(0.01)


if __name__ == "__main__":
    main()
