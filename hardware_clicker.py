#!/usr/bin/env python3
"""
Hardware-Level Click Server for XRDP Environments - ROBUST VERSION
Receives captcha coordinates via WebSocket and performs hardware clicks using xdotool.

Features:
- Finds Firefox window and gets its position
- Converts viewport coordinates to screen-absolute coordinates
- Focuses Firefox window before clicking
- Uses human-like click sequence
- Detailed logging for debugging
"""

import asyncio
import json
import subprocess
import logging
import os
import sys
import re
import time
import random
from typing import Optional, Tuple

try:
    import websockets
except ImportError:
    print("Installing websockets...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("HardwareClicker")


class HardwareClicker:
    """Handles hardware-level mouse input using xdotool."""
    
    def __init__(self, display: str = ":0"):
        self.display = display
        self.firefox_window_id = None
        self.window_geometry = None
        self.browser_chrome_height = 85  # Default: tabs + address bar
        self._verify_xdotool()
    
    def _verify_xdotool(self) -> None:
        """Verify xdotool is installed."""
        try:
            result = subprocess.run(
                ["xdotool", "version"],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display}
            )
            if result.returncode == 0:
                logger.info(f"✓ xdotool available: {result.stdout.strip()}")
        except FileNotFoundError:
            logger.error("❌ xdotool not found! Install with: apt-get install xdotool")
    
    def set_chrome_height(self, height: int):
        """Set browser chrome height (tabs + address bar)."""
        self.browser_chrome_height = height
        logger.info(f"Browser chrome height set to: {height}px")
    
    def find_firefox_window(self) -> Optional[str]:
        """Find the Firefox window ID."""
        try:
            # Try to find by class first
            result = subprocess.run(
                ["xdotool", "search", "--class", "firefox"],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display}
            )
            
            if result.returncode == 0 and result.stdout.strip():
                windows = result.stdout.strip().split('\n')
                # Find the main window (usually the largest or first visible one)
                for win_id in windows:
                    win_id = win_id.strip()
                    if win_id:
                        # Check if window is visible
                        vis_result = subprocess.run(
                            ["xdotool", "getwindowname", win_id],
                            capture_output=True,
                            text=True,
                            env={**os.environ, "DISPLAY": self.display}
                        )
                        if vis_result.returncode == 0:
                            name = vis_result.stdout.strip()
                            logger.info(f"Found Firefox window: {win_id} - '{name}'")
                            return win_id
            
            logger.warning("Could not find Firefox window by class")
            return None
            
        except Exception as e:
            logger.error(f"Error finding Firefox window: {e}")
            return None
    
    def get_window_geometry(self, window_id: str) -> Optional[Tuple[int, int, int, int]]:
        """Get window position and size (x, y, width, height)."""
        try:
            result = subprocess.run(
                ["xdotool", "getwindowgeometry", window_id],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display}
            )
            
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                x, y = 0, 0
                width, height = 1280, 720
                
                for line in lines:
                    pos_match = re.search(r'Position:\s*(\d+),\s*(\d+)', line)
                    if pos_match:
                        x = int(pos_match.group(1))
                        y = int(pos_match.group(2))
                    
                    geom_match = re.search(r'Geometry:\s*(\d+)x(\d+)', line)
                    if geom_match:
                        width = int(geom_match.group(1))
                        height = int(geom_match.group(2))
                
                logger.info(f"Window {window_id} geometry: pos=({x}, {y}), size={width}x{height}")
                return x, y, width, height
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting window geometry: {e}")
            return None
    
    def get_screen_info(self):
        """Get screen information for coordinate conversion."""
        window_id = self.find_firefox_window()
        
        if window_id:
            geometry = self.get_window_geometry(window_id)
            if geometry:
                return {
                    'window_id': window_id,
                    'x': geometry[0],
                    'y': geometry[1],
                    'width': geometry[2],
                    'height': geometry[3],
                    'chrome_height': self.browser_chrome_height
                }
        
        # Fallback - assume window at (0,0)
        return {
            'window_id': None,
            'x': 0,
            'y': 0,
            'width': 1280,
            'height': 720,
            'chrome_height': self.browser_chrome_height
        }
    
    def viewport_to_screen(self, viewport_x: int, viewport_y: int) -> Tuple[int, int]:
        """
        Convert viewport coordinates to screen-absolute coordinates.
        
        Viewport coords: relative to browser content area (what JS sees)
        Screen coords: absolute position on X11 display (what xdotool needs)
        """
        screen_info = self.get_screen_info()
        
        # Formula:
        # screen_x = window_x + viewport_x
        # screen_y = window_y + chrome_height + viewport_y
        
        screen_x = screen_info['x'] + viewport_x
        screen_y = screen_info['y'] + screen_info['chrome_height'] + viewport_y
        
        logger.info(f"Coordinate conversion:")
        logger.info(f"  Viewport: ({viewport_x}, {viewport_y})")
        logger.info(f"  Window pos: ({screen_info['x']}, {screen_info['y']})")
        logger.info(f"  Chrome height: {screen_info['chrome_height']}")
        logger.info(f"  Screen: ({screen_x}, {screen_y})")
        
        return screen_x, screen_y
    
    def focus_window(self, window_id: str) -> bool:
        """Focus/activate a window."""
        try:
            result = subprocess.run(
                ["xdotool", "windowactivate", "--sync", window_id],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display},
                timeout=5
            )
            
            if result.returncode == 0:
                logger.info(f"✓ Window {window_id} focused")
                return True
            else:
                logger.warning(f"Failed to focus window: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error focusing window: {e}")
            return False
    
    def get_mouse_position(self) -> Tuple[int, int]:
        """Get current mouse position."""
        result = subprocess.run(
            ["xdotool", "getmouselocation", "--shell"],
            capture_output=True,
            text=True,
            env={**os.environ, "DISPLAY": self.display}
        )
        
        x, y = 0, 0
        for line in result.stdout.strip().split('\n'):
            if line.startswith('X='):
                x = int(line.split('=')[1])
            elif line.startswith('Y='):
                y = int(line.split('=')[1])
        
        return x, y
    
    def human_like_click(self, screen_x: int, screen_y: int) -> bool:
        """
        Perform a human-like click at screen coordinates.
        Uses separate mousemove, mousedown, mouseup with realistic delays.
        """
        try:
            logger.info(f"🖱️ Performing human-like click at screen ({screen_x}, {screen_y})")
            
            # Focus Firefox window first if we have it
            screen_info = self.get_screen_info()
            if screen_info['window_id']:
                self.focus_window(screen_info['window_id'])
                time.sleep(0.1)
            
            # Get current mouse position
            curr_x, curr_y = self.get_mouse_position()
            logger.info(f"  Current mouse: ({curr_x}, {curr_y})")
            
            # Random pre-movement delay (50-200ms)
            pre_delay = random.uniform(0.05, 0.2)
            time.sleep(pre_delay)
            
            # Move mouse to target
            move_result = subprocess.run(
                ["xdotool", "mousemove", "--sync", str(screen_x), str(screen_y)],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display},
                timeout=5
            )
            
            if move_result.returncode != 0:
                logger.error(f"Mouse move failed: {move_result.stderr}")
                return False
            
            logger.info(f"  Mouse moved to ({screen_x}, {screen_y})")
            
            # Random delay before click (50-150ms)
            click_delay = random.uniform(0.05, 0.15)
            time.sleep(click_delay)
            
            # Mouse down
            down_result = subprocess.run(
                ["xdotool", "mousedown", "1"],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display},
                timeout=2
            )
            
            if down_result.returncode != 0:
                logger.error(f"Mouse down failed: {down_result.stderr}")
                return False
            
            # Random hold time (80-200ms)
            hold_time = random.uniform(0.08, 0.2)
            time.sleep(hold_time)
            
            # Mouse up
            up_result = subprocess.run(
                ["xdotool", "mouseup", "1"],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display},
                timeout=2
            )
            
            if up_result.returncode != 0:
                logger.error(f"Mouse up failed: {up_result.stderr}")
                return False
            
            # Verify final position
            final_x, final_y = self.get_mouse_position()
            logger.info(f"  ✓ Click complete. Mouse now at: ({final_x}, {final_y})")
            
            return True
            
        except subprocess.TimeoutExpired:
            logger.error("Click command timed out")
            return False
        except Exception as e:
            logger.error(f"Click failed: {e}")
            return False
    
    def click_at_viewport(self, viewport_x: int, viewport_y: int) -> bool:
        """
        Click at viewport-relative coordinates.
        This is the main method to call for CAPTCHA clicking.
        """
        # Convert to screen coordinates
        screen_x, screen_y = self.viewport_to_screen(viewport_x, viewport_y)
        
        # Perform human-like click
        return self.human_like_click(screen_x, screen_y)


class CaptchaWebSocketServer:
    """WebSocket server for handling click requests."""
    
    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self.clicker = HardwareClicker()
        self.clients = set()
    
    async def handle_message(self, websocket, data: dict) -> dict:
        """Process incoming WebSocket message."""
        action = data.get("action")
        
        if action == "set_chrome_offset":
            height = data.get("offset", 85)
            self.clicker.set_chrome_height(height)
            return {"success": True, "offset": height}
        
        elif action == "get_screen_info":
            info = self.clicker.get_screen_info()
            return {"success": True, "screen_info": info}
        
        elif action == "get_mouse_pos":
            x, y = self.clicker.get_mouse_position()
            return {"success": True, "x": x, "y": y}
        
        elif action == "click":
            x = data.get("x")
            y = data.get("y")
            
            if x is None or y is None:
                return {"success": False, "error": "Missing coordinates"}
            
            success = self.clicker.click_at_viewport(int(x), int(y))
            return {"success": success, "action": "click", "x": x, "y": y}
        
        elif action == "captcha_detected":
            x = data.get("x")
            y = data.get("y")
            captcha_type = data.get("captcha_type", "cloudflare")
            
            logger.warning(f"🤖 CAPTCHA DETECTED: {captcha_type} at viewport ({x}, {y})")
            
            success = self.clicker.click_at_viewport(int(x), int(y))
            
            return {
                "success": success,
                "action": "captcha_handled",
                "captcha_type": captcha_type
            }
        
        elif action == "ping":
            return {"success": True, "action": "pong"}
        
        else:
            return {"success": False, "error": f"Unknown action: {action}"}
    
    async def handle_client(self, websocket):
        """Handle client connection."""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        logger.info(f"🔌 Client connected: {client_addr}")
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    response = await self.handle_message(websocket, data)
                    await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({"success": False, "error": "Invalid JSON"}))
                except Exception as e:
                    logger.error(f"Error: {e}")
                    await websocket.send(json.dumps({"success": False, "error": str(e)}))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            logger.info(f"❌ Client disconnected: {client_addr}")
    
    async def start(self):
        """Start the WebSocket server."""
        logger.info(f"🚀 Hardware Click Server starting on ws://{self.host}:{self.port}")
        
        async with websockets.serve(
            self.handle_client,
            self.host,
            self.port,
            ping_interval=30,
            ping_timeout=10
        ):
            logger.info("✓ Server running, waiting for connections...")
            await asyncio.Future()


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Hardware Click Server for XRDP")
    parser.add_argument("--host", default="0.0.0.0", help="WebSocket host")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--display", default=":0", help="X11 display")
    
    args = parser.parse_args()
    os.environ["DISPLAY"] = args.display
    
    server = CaptchaWebSocketServer(host=args.host, port=args.port)
    
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("\n👋 Server shutting down...")


if __name__ == "__main__":
    main()
