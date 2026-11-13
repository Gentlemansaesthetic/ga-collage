"""Background removal for the robot. Mirrors js/cutout.js (autoMask).

Only a mask is computed; the kept pixels are always the original product photo.
Nothing is generated or redrawn.
"""
import io

import numpy as np
from PIL import Image
from scipy import ndimage

from common import colour_name, lightness

SIZE = 1024
MAX_SIDE = 1600
OUT_SIDE = 900
_session = None


def session(model_path):
    global _session
    if _session is None:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        _session = ort.InferenceSession(model_path, opts, providers=['CPUExecutionProvider'])
    return _session


def open_photo(data):
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA' if 'A' in im.getbands() or 'transparency' in im.info else 'RGB')
    if max(im.size) > MAX_SIDE:
        k = MAX_SIDE / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    return im


def existing_alpha(im):
    if im.mode != 'RGBA':
        return None
    a = np.asarray(im)[:, :, 3]
    if (a < 250).mean() < 0.02:
        return None
    return a.copy()


def border_pixels(rgb):
    return np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.int16)


def border_uniformity(rgb):
    px = border_pixels(rgb)
    med = np.median(px, axis=0)
    return float((np.abs(px - med).max(axis=1) <= 16).mean())


def ai_mask(rgb, model_path):
    h, w = rgb.shape[:2]
    small = np.asarray(Image.fromarray(rgb).resize((SIZE, SIZE), Image.BICUBIC), dtype=np.float32)
    x = ((small - 128) / 256).transpose(2, 0, 1)[None]
    s = session(model_path)
    inp = s.get_inputs()[0]
    if 'float16' in inp.type:
        x = x.astype(np.float16)
    out = s.run(None, {inp.name: x})[0].reshape(SIZE, SIZE).astype(np.float32)
    m = np.clip(out * 255, 0, 255)
    lo, hi = 70, 215
    m = np.clip((m - lo) / (hi - lo), 0, 1) * 255
    return np.asarray(Image.fromarray(m.astype(np.uint8)).resize((w, h), Image.BILINEAR))


def plain_mask(rgb, tol=28):
    px = border_pixels(rgb)
    med = np.median(px, axis=0)
    dist = np.abs(rgb.astype(np.int16) - med).max(axis=2)
    close = dist <= tol
    lab, _ = ndimage.label(close, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge_labels = edge_labels[edge_labels > 0]
    bg = np.isin(lab, edge_labels)
    a = np.where(bg, 0, 255).astype(np.uint8)
    # soften the outermost ring of the product, like the app does
    ring = (~bg) & ndimage.binary_dilation(bg, structure=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    k = np.clip(dist / (tol * 2.5), 0.25, 1)
    a[ring] = np.round(255 * k[ring]).astype(np.uint8)
    return a


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def auto_mask(rgb, model_path):
    h, w = rgb.shape[:2]
    plain_ok = border_uniformity(rgb) >= 0.8
    try:
        ai = ai_mask(rgb, model_path)
    except Exception as e:  # noqa: BLE001
        if plain_ok:
            return plain_mask(rgb), 'plain'
        raise e
    if not plain_ok:
        return ai, 'ai'
    plain = plain_mask(rgb)
    A, B = ai > 128, plain > 128
    inter = (A & B).sum()
    na, nb = A.sum(), B.sum()
    iou = inter / max(1, na + nb - inter)
    if iou >= 0.82:
        r = max(4, round(max(w, h) * 0.008))
        grown = ndimage.grey_dilation(ai, footprint=disk(r))
        return np.minimum(plain, grown), 'auto'
    if na < nb * 0.6 and nb / (w * h) < 0.9:
        return plain, 'plain'
    return ai, 'ai'


def tighten(a):
    return ndimage.grey_erosion(a, footprint=[[0, 1, 0], [1, 1, 1], [0, 1, 0]])


_faces = None


def has_face(rgb):
    """True if a human face is in the photo - those are pictures of someone wearing the item, not the product alone."""
    global _faces
    try:
        import cv2
    except ImportError:
        return False
    if _faces is None:
        _faces = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    k = 640 / max(grey.shape)
    if k < 1:
        grey = cv2.resize(grey, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    side = max(24, min(grey.shape) // 12)
    found = _faces.detectMultiScale(grey, scaleFactor=1.1, minNeighbors=6, minSize=(side, side))
    return len(found) > 0


def cut(data, model_path, category='other'):
    """Photo bytes -> (RGBA PIL image, info) or (None, reason)."""
    im = open_photo(data)
    alpha = existing_alpha(im)
    rgb = np.asarray(im.convert('RGB'))
    method = 'alpha'
    if alpha is None:
        if border_uniformity(rgb) < 0.6:
            return None, 'busy background (probably a photo of someone wearing it)'
        alpha, method = auto_mask(rgb, model_path)
        alpha = tighten(alpha)
    keep = alpha > 128
    cover = keep.mean()
    if cover < 0.03:
        return None, 'product not found'
    if cover > 0.93:
        return None, 'background not removed'
    edge = np.concatenate([keep[0], keep[-1], keep[:, 0], keep[:, -1]]).mean()
    if edge > 0.06:
        return None, 'product is cut off at the photo edge'
    if has_face(rgb):
        return None, 'a person is in the photo'
    ys, xs = np.nonzero(alpha > 10)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([rgb, alpha])[y0:y1, x0:x1]
    out = Image.fromarray(rgba, 'RGBA')
    if max(out.size) > OUT_SIDE:
        k = OUT_SIDE / max(out.size)
        out = out.resize((max(1, round(out.width * k)), max(1, round(out.height * k))), Image.LANCZOS)
    return out, {'method': method, 'colour': main_colour(rgb, keep)}


def main_colour(rgb, keep):
    sel = rgb[keep]
    if len(sel) > 40000:
        sel = sel[:: len(sel) // 40000]
    q = Image.fromarray(sel.reshape(-1, 1, 3)).quantize(colors=4, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:12]
    counts = sorted(q.getcolors(), reverse=True)
    idx = counts[0][1]
    rgb0 = tuple(pal[idx * 3: idx * 3 + 3])
    name, family = colour_name(rgb0)
    return {'name': name, 'family': family, 'rgb': list(rgb0), 'light': lightness(rgb0)}


def colour_of_cutout(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)
    return main_colour(a[:, :, :3], a[:, :, 3] > 128)
