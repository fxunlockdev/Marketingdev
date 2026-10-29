"""Build explicit faces: node-canvas/Pango does not select variable font axes reliably."""
from pathlib import Path
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(sys.argv[1])
destination = Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
for path in root.glob('*.ttf'):
    font = TTFont(path)
    if 'fvar' not in font:
        continue
    axes = {axis.axisTag: axis for axis in font['fvar'].axes}
    weight_axis = axes.get('wght')
    if weight_axis is None:
        continue
    for weight in range(100, 901, 100):
        if not weight_axis.minValue <= weight <= weight_axis.maxValue:
            continue
        coordinates = {tag: axis.defaultValue for tag, axis in axes.items()}
        coordinates['wght'] = weight
        instance = instantiateVariableFont(font, coordinates, inplace=False)
        # Unique internal names avoid Fontconfig merging variable instances.
        family = f'Desvio {path.stem} {weight}'
        for record in instance['name'].names:
            if record.nameID in (1, 4, 6, 16):
                value = family.replace(' ', '') if record.nameID == 6 else family
                record.string = value.encode(record.getEncoding(), errors='replace')
            elif record.nameID in (2, 17):
                record.string = 'Regular'.encode(record.getEncoding(), errors='replace')
        instance.save(destination / f'{path.stem}-{weight}.ttf')
