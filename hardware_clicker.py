#!/usr/bin/env python3
"""
Hardware-Level Click Server for XRDP Environments
Receives captcha coordinates via WebSocket and performs hardware clicks using xdotool.

The key insight: Cloudflare Turnstile detects JS-simulated clicks vs real hardware events.
xdotool generates events at the X11 server level, which appear as hardware input to applications
running under XRDP.
"""

import asyncio
import json
import subprocess
import logging
import os
import sys
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
    """
    Handles hardware-level mouse input using xdotool.
    xdotool generates X11 input events that appear as hardware input to applications.
    """
    
    def __init__(self, display: str = ":0"):
        self.display = display
        self._verify_xdotool()
    
    def _verify_xdotool(self) -> None:
        """Verify xdotool is installed and accessible."""
        try:
            result = subprocess.run(
                ["xdotool", "version"],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display}
            )
            if result.returncode == 0:
                logger.info(f"✓ xdotool available: {result.stdout.strip()}")
            else:
                raise RuntimeError("xdotool not working properly")
        except FileNotFoundError:
            logger.error("❌ xdotool not found! Install with: apt-get install xdotool")
            raise
    
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
    
    def move_mouse(self, x: int, y: int) -> bool:
        """Move mouse to absolute coordinates."""
        try:
            result = subprocess.run(
                ["xdotool", "mousemove", str(x), str(y)],
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display},
                timeout=5
            )
            return result.returncode == 0
        except Exception as e:
            logger.error(f"Failed to move mouse: {e}")
            return False
    
    def click(self, x: int, y: int, button: int = 1, delay_ms: int = 100) -> bool:
        """
        Perform a hardware-level click at the specified coordinates.
        
        Args:
            x: X coordinate (screen absolute)
            y: Y coordinate (screen absolute)
            button: Mouse button (1=left, 2=middle, 3=right)
            delay_ms: Delay between mouse down and up in milliseconds
        
        Returns:
            True if successful, False otherwise
        """
        try:
            # Method 1: Single command with mousemove + click
            # This is more reliable for X11 applications
            cmd = [
                "xdotool", 
                "mousemove", str(x), str(y),
                "click", "--delay", str(delay_ms), str(button)
            ]
            
            logger.info(f"🎯 Executing hardware click at ({x}, {y})")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                env={**os.environ, "DISPLAY": self.display},
                timeout=10
            )
            
            if result.returncode == 0:
                logger.info(f"✓ Click executed successfully at ({x}, {y})")
                return True
            else:
                logger.error(f"Click failed: {result.stderr}")
                return False
                
        except subprocess.TimeoutExpired:
            logger.error("Click command timed out")
            return False
        except Exception as e:
            logger.error(f"Click failed with exception: {e}")
            return False
    
    def click_with_human_delay(self, x: int, y: int) -> bool:
        """
        Perform click with randomized human-like delays.
        This helps bypass bot detection that looks for inhumanly fast clicks.
        """
        import random
        
        # Random small delay before clicking (100-300ms)
        pre_delay = random.randint(100, 300)
        asyncio.run(asyncio.sleep(pre_delay / 1000))
        
        # Move to position
        self.move_mouse(x, y)
        
        # Random delay between move and click (50-150ms)
        move_delay = random.randint(50, 150)
        asyncio.run(asyncio.sleep(move_delay / 1000))
        
        # Click with randomized hold time
        hold_time = random.randint(80, 200)
        return self.click(x, y, delay_ms=hold_time)


class CaptchaWebSocketServer:
    """
    WebSocket server that receives captcha coordinates and triggers hardware clicks.
    """
    
    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self.clicker = HardwareClicker()
        self.clients = set()
    
    async def handle_message(self, websocket, data: dict) -> dict:
        """Process incoming WebSocket message."""
        action = data.get("action")
        
        if action == "click":
            # Direct click at specified coordinates
            x = data.get("x")
            y = data.get("y")
            
            if x is None or y is None:
                return {"success": False, "error": "Missing x or y coordinates"}
            
            # Perform hardware click
            success = self.clicker.click(int(x), int(y))
            
            return {
                "success": success,
                "action": "click",
                "x": x,
                "y": y
            }
        
        elif action == "click_element":
            # Click with element info (for logging/debugging)
            x = data.get("x")
            y = data.get("y")
            element_type = data.get("element_type", "unknown")
            iframe_info = data.get("iframe", None)
            
            logger.info(f"📍 Click request for {element_type} at ({x}, {y})")
            if iframe_info:
                logger.info(f"   Iframe offset: {iframe_info}")
            
            success = self.clicker.click(int(x), int(y))
            
            return {
                "success": success,
                "action": "click_element",
                "element_type": element_type
            }
        
        elif action == "captcha_detected":
            # Cloudflare Turnstile or other captcha detected
            x = data.get("x")
            y = data.get("y")
            captcha_type = data.get("captcha_type", "cloudflare")
            
            logger.warning(f"🤖 CAPTCHA DETECTED: {captcha_type} at ({x}, {y})")
            
            # Perform click
            success = self.clicker.click(int(x), int(y))
            
            return {
                "success": success,
                "action": "captcha_handled",
                "captcha_type": captcha_type
            }
        
        elif action == "get_mouse_pos":
            # Get current mouse position
            x, y = self.clicker.get_mouse_position()
            return {
                "success": True,
                "x": x,
                "y": y
            }
        
        elif action == "ping":
            return {"success": True, "action": "pong"}
        
        else:
            return {"success": False, "error": f"Unknown action: {action}"}
    
    async def handle_client(self, websocket):
        """Handle a single client connection."""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        logger.info(f"🔌 Client connected: {client_addr}")
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    logger.debug(f"📥 Received: {data}")
                    
                    response = await self.handle_message(websocket, data)
                    await websocket.send(json.dumps(response))
                    
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "success": False,
                        "error": "Invalid JSON"
                    }))
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    await websocket.send(json.dumps({
                        "success": False,
                        "error": str(e)
                    }))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            logger.info(f"❌ Client disconnected: {client_addr}")
    
    async def start(self):
        """Start the WebSocket server."""
        logger.info(f"🚀 Starting Hardware Click Server on ws://{self.host}:{self.port}")
        
        async with websockets.serve(
            self.handle_client,
            self.host,
            self.port,
            ping_interval=30,
            ping_timeout=10
        ):
            logger.info("✓ Server is running and waiting for connections...")
            await asyncio.Future()  # Run forever


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Hardware Click Server for XRDP")
    parser.add_argument("--host", default="0.0.0.0", help="WebSocket host")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--display", default=":0", help="X11 display")
    
    args = parser.parse_args()
    
    # Set display environment variable
    os.environ["DISPLAY"] = args.display
    
    # Create and start server
    server = CaptchaWebSocketServer(host=args.host, port=args.port)
    
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("\n👋 Server shutting down...")


if __name__ == "__main__":
    main()
