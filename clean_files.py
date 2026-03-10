import os
import re

files_to_clean = [
    'public/client.html',
    'public/comanda.html',
    'public/checkstock.html',
    'public/foi_parcurs.html'
]

# Corrupted char mappings
replacements = {
    'ș': 's', 'ț': 't', 'â': 'a', 'î': 'i', 'ă': 'a',
    'Ș': 'S', 'Ț': 'T', 'Â': 'A', 'Î': 'I', 'Ă': 'A',
    'Ã®': 'i', 'Ã¢': 'a', 'Äƒ': 'a', 'È›': 't', 'ÅŸ': 's',
    'ÃŽ': 'I', 'Ã': 'A', 'È': 't', 'Ä': 'a', 'Å': 'a',
    'ðŸ': '', 'â': 'a', 'œ': '', 'ž': 'z', 'Ÿ': 'y',
    'ï': 'i', '¿': '', '½': '', '�': '', '›': '',
    'ƒ': 'f', '†': 't', '€': 'E', 'ž': 'z', 'Ÿ': 'y',
    'Èš': 'S', 'È›': 't', 'Å£': 't', 'Å¡': 's',
    'Ã¡': 'a', 'Ã©': 'e', 'Ã­': 'i', 'Ã³': 'o', 'Ãº': 'u',
    'Ã': 'A', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
    'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ü': 'u',
    'ÿ': 'y', 'ç': 'c', 'Ç': 'C', 'ñ': 'n', 'Ñ': 'N',
}

for filepath in files_to_clean:
    full_path = os.path.join(os.path.dirname(__file__), filepath)
    if not os.path.exists(full_path):
        print(f'File not found: {filepath}')
        continue
    
    try:
        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        
        original = content
        
        # Replace all corrupted characters
        for bad, good in replacements.items():
            content = content.replace(bad, good)
        
        # Remove any remaining control/high characters
        content = ''.join(c if ord(c) < 128 or c in '\n\r\t' else '' for c in content)
        
        # Fix common words
        content = content.replace('clien i', 'clienti')
        content = content.replace('Clien i', 'Clienti')
        content = content.replace(' pre i', ' preturi')
        content = content.replace('Pre i', 'Preturi')
        content = content.replace('recep ie', 'receptie')
        content = content.replace('Recep ie', 'Receptie')
        content = content.replace('localita i', 'localitati')
        content = content.replace('Localita i', 'Localitati')
        content = content.replace('ofer', 'sofer')
        content = content.replace('Ofer', 'Sofer')
        content = content.replace('ma ina', 'masina')
        content = content.replace('Ma ina', 'Masina')
        content = content.replace('inmatriculare', 'inmatriculare')
        content = content.replace('Inmatriculare', 'Inmatriculare')
        content = content.replace('rute', 'rute')
        content = content.replace('parcurs', 'parcurs')
        content = content.replace('Parcurs', 'Parcurs')
        content = content.replace('foi', 'foi')
        content = content.replace('Foi', 'Foi')
        content = content.replace('deplasarii', 'deplasarii')
        content = content.replace('Deplasarii', 'Deplasarii')
        content = content.replace('scopul', 'scopul')
        content = content.replace('Scopul', 'Scopul')
        content = content.replace('alimentare', 'alimentare')
        content = content.replace('Alimentare', 'Alimentare')
        content = content.replace('combustibil', 'combustibil')
        content = content.replace('Combustibil', 'Combustibil')
        content = content.replace('verificare', 'verificare')
        content = content.replace('Verificare', 'Verificare')
        content = content.replace('tehnica', 'tehnica')
        content = content.replace('Tehnica', 'Tehnica')
        content = content.replace('plecare', 'plecare')
        content = content.replace('Plecare', 'Plecare')
        content = content.replace('sosire', 'sosire')
        content = content.replace('Sosire', 'Sosire')
        content = content.replace('salvare', 'salvare')
        content = content.replace('Salvare', 'Salvare')
        content = content.replace('resetare', 'resetare')
        content = content.replace('Resetare', 'Resetare')
        
        # Remove double spaces
        content = re.sub(r'  +', ' ', content)
        
        if content != original:
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'Cleaned: {filepath}')
        else:
            print(f'No changes: {filepath}')
            
    except Exception as e:
        print(f'Error with {filepath}: {e}')

print('Done!')
