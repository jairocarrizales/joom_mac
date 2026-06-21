#!/usr/bin/env python3
"""Genera build/icon_master.png (1024x1024) para Loomcito.
Diseño: squircle morado con degradado + botón de grabación (disco blanco
con punto rojo). Sin dependencias externas (PNG escrito a mano)."""
import struct, zlib, math

S = 1024


def clamp(v, a=0.0, b=1.0):
    return a if v < a else b if v > b else v


def mix(c1, c2, t):
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))


def sdf_round_rect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - hw + r
    qy = abs(py - cy) - hh + r
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def over(dst, src):
    sa = src[3]
    da = dst[3]
    oa = sa + da * (1 - sa)
    if oa <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    r = (src[0] * sa + dst[0] * da * (1 - sa)) / oa
    g = (src[1] * sa + dst[1] * da * (1 - sa)) / oa
    b = (src[2] * sa + dst[2] * da * (1 - sa)) / oa
    return (r, g, b, oa)


# Paleta
TOP = (0.49, 0.42, 0.94)     # #7d6cf0
BOT = (0.33, 0.28, 0.80)     # ~#544bcc
WHITE = (1.0, 1.0, 1.0)
RED = (1.0, 0.30, 0.33)      # #ff4d54

cx = cy = S / 2
margin = 84
hw = hh = S / 2 - margin
corner = 205
disc_r = 250        # disco blanco
dot_r = 116         # punto rojo

px_bytes = bytearray(S * S * 4)

for y in range(S):
    py = y + 0.5
    for x in range(S):
        px = x + 0.5
        col = (0.0, 0.0, 0.0, 0.0)

        # Fondo squircle con degradado vertical
        sd = sdf_round_rect(px, py, cx, cy, hw, hh, corner)
        cov = clamp(0.5 - sd)
        if cov > 0:
            g = mix(TOP, BOT, clamp((py - margin) / (S - 2 * margin)))
            col = over(col, (g[0], g[1], g[2], cov))

        # Disco blanco
        d = math.hypot(px - cx, py - cy) - disc_r
        cw = clamp(0.5 - d)
        if cw > 0:
            col = over(col, (WHITE[0], WHITE[1], WHITE[2], cw))

        # Punto rojo (grabación)
        d2 = math.hypot(px - cx, py - cy) - dot_r
        cr = clamp(0.5 - d2)
        if cr > 0:
            col = over(col, (RED[0], RED[1], RED[2], cr))

        i = (y * S + x) * 4
        px_bytes[i] = int(clamp(col[0]) * 255 + 0.5)
        px_bytes[i + 1] = int(clamp(col[1]) * 255 + 0.5)
        px_bytes[i + 2] = int(clamp(col[2]) * 255 + 0.5)
        px_bytes[i + 3] = int(clamp(col[3]) * 255 + 0.5)


def chunk(typ, data):
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)


def write_png(path):
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0)
    raw = bytearray()
    row = S * 4
    for y in range(S):
        raw.append(0)
        raw.extend(px_bytes[y * row:(y + 1) * row])
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


write_png("build/icon_master.png")
print("ok build/icon_master.png")
