import matplotlib.pyplot as plt

def setup_chinese_font():
    plt.rcParams["font.family"] = ["Noto Sans CJK SC", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False
