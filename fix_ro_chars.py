import re

files = [
    'public/checkstock.html',
    'public/stock.html', 
    'public/foi_parcurs.html'
]

for filepath in files:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            c = f.read()
        
        # Romanian diacritics
        c = c.replace('ș', 's')
        c = c.replace('ț', 't')
        c = c.replace('â', 'a')
        c = c.replace('î', 'i')
        c = c.replace('ă', 'a')
        c = c.replace('Î', 'I')
        c = c.replace('Â', 'A')
        c = c.replace('Ă', 'A')
        c = c.replace('Ș', 'S')
        c = c.replace('Ț', 'T')
        
        # Corrupted patterns
        c = re.sub(r'[ÃÄ][ÅŸ]', 's', c)
        c = re.sub(r'[ÃÄ][Æ£]', 't', c)
        c = re.sub(r'[ÃÃ¢]', 'a', c)
        c = re.sub(r'[ÃÃ®]', 'i', c)
        c = re.sub(r'[ÃÃ]', 'A', c)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(c)
        print(f'Fixed: {filepath}')
    except Exception as e:
        print(f'Error with {filepath}: {e}')

print('Done!')
