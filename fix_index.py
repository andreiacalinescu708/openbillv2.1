import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    c = f.read()

# Emoji replacements
c = c.replace('ðŸ‘¥', '&#128101;')  # people
c = c.replace('ðŸ’°', '&#128176;')  # money
c = c.replace('ðŸ“‹', '&#128203;')  # clipboard
c = c.replace('ðŸ“¦', '&#128230;')  # package
c = c.replace('âž•', '+')           # plus sign
c = c.replace('ðŸ§¾', '&#128207;')  # clipboard with check
c = c.replace('ðŸ“Š', '&#128202;')  # chart
c = c.replace('âš™ï¸', '&#9881;')  # settings
c = c.replace('âš™', '&#9881;')     # settings short
c = c.replace('ðŸ“ˆ', '&#128200;')  # trending up
c = c.replace('ðŸ“', '&#128193;')  # folder

# Romanian diacritics fixes
c = c.replace('ș', 's')
c = c.replace('ț', 't')
c = c.replace('â', 'a')
c = c.replace('î', 'i')
c = c.replace('ă', 'a')

# Fix common words
import re
c = re.sub(r'Clien[țţt]i', 'Clienti', c)
c = re.sub(r'Pre[țţt]uri', 'Preturi', c)
c = re.sub(r'Recep[țţt]ie', 'Receptie', c)
c = re.sub(r'Administrare', 'Administrare', c)
c = re.sub(r'Rapoarte', 'Rapoarte', c)
c = re.sub(r'În curând', 'In curand', c)
c = re.sub(r'Încarcă', 'Incarca', c)
c = re.sub(r'[sș]istem', 'sistem', c)
c = re.sub(r'font-[sș]ize', 'font-size', c)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(c)

print('Fixed index.html')
