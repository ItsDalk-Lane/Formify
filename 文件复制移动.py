import os
import shutil
import time
import argparse
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

def format_size(size_bytes):
    """将字节大小转换为人类可读的格式"""
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024*1024:
        return f"{size_bytes/1024:.2f}KB"
    else:
        return f"{size_bytes/(1024*1024):.2f}MB"

def copy_files_with_replace(source_files, destination_folder):
    """
    复制多个文件到指定目录，如果文件名相同则自动替换
    
    Args:
        source_files: 源文件路径列表
        destination_folder: 目标文件夹路径
    """
    # 确保目标文件夹存在
    destination_path = Path(destination_folder)
    destination_path.mkdir(parents=True, exist_ok=True)
    
    success_count = 0
    error_count = 0
    total_source_size = 0
    total_dest_size = 0
    
    for source_file in source_files:
        try:
            source_path = Path(source_file)
            
            # 检查源文件是否存在
            if not source_path.exists():
                print(f"❌ 源文件不存在: {source_file}")
                error_count += 1
                continue
            
            # 获取源文件大小
            source_size = source_path.stat().st_size
            total_source_size += source_size
            
            # 构建目标文件路径
            destination_file = destination_path / source_path.name
            
            # 记录目标文件原始大小（如果存在）
            orig_dest_size = destination_file.stat().st_size if destination_file.exists() else 0
            
            # 复制文件（如果存在同名文件会自动替换）
            shutil.copy2(source_file, destination_file)
            
            # 获取复制后的目标文件大小
            dest_size = destination_file.stat().st_size
            total_dest_size += dest_size
            
            # 计算大小变化
            size_change = dest_size - orig_dest_size
            change_symbol = "+" if size_change > 0 else ("-" if size_change < 0 else "")
            size_change_str = f"({format_size(orig_dest_size)} → {format_size(dest_size)})"
            if orig_dest_size > 0:
                size_change_str += f" [{change_symbol}{format_size(abs(size_change))}]"
            
            print(f"✅ 成功复制: {source_path.name} {size_change_str} -> {destination_folder}")
            success_count += 1
            
        except Exception as e:
            print(f"❌ 复制失败 {source_file}: {str(e)}")
            error_count += 1
    
    # 计算总大小变化
    total_change = total_dest_size - total_source_size
    change_symbol = "+" if total_change > 0 else ("-" if total_change < 0 else "")
    total_size_str = f"总大小: {format_size(total_source_size)} → {format_size(total_dest_size)}"
    if total_change != 0:
        total_size_str += f" [{change_symbol}{format_size(abs(total_change))}]"
    
    # 使用单行f-string避免多行缩进问题
    print(f"\n📊 复制完成! 成功: {success_count}, 失败: {error_count} | {total_size_str}")

# 存储多对文件路径配置
file_pairs = {
    "pair1": {
        "name": "form-flow插件文件-Obsidian沙箱仓库",
        "source_files": [
            r"C:\Desktop\code\form-flow\plugin\manifest.json",
            r"C:\Desktop\code\form-flow\plugin\main.js",
            r"C:\Desktop\code\form-flow\plugin\styles.css"
        ],
        "target_folder": r"C:\Code\Obsidian沙箱仓库\.obsidian\plugins\form-flow"
    },
    "pair2": {
        "name": "Lmmersive主题",
        "source_files": [
            r"C:\Desktop\code\Lmmersive\manifest.json",
            r"C:\Desktop\code\Lmmersive\theme.css"
        ],
        "target_folder": r"C:\Code\Obsidian沙箱仓库\.obsidian\themes\Lmmersive"
    },
    "pair3": {
        "name": "git-auto插件文件",
        "source_files": [
            r"C:\Desktop\code\git-auto\manifest.json",
            r"C:\Desktop\code\git-auto\main.js",
            r"C:\Desktop\code\git-auto\styles.css"
        ],
        "target_folder": r"C:\Code\Obsidian沙箱仓库\.obsidian\plugins\git-auto"
    },
    "pair4": {
        "name": "form-flow插件文件-笔记互传",
        "source_files": [
            r"C:\Desktop\code\obsidian-form-flow-master\plugin\manifest.json",
            r"C:\Desktop\code\obsidian-form-flow-master\plugin\main.js",
            r"C:\Desktop\code\obsidian-form-flow-master\plugin\styles.css"
        ],
        "target_folder": r"C:\Desktop\TakeAction\B-Dailylife\笔记互传\.obsidian\plugins\form-flow"
    },
    "pair5": {
        "name": "form-flow插件文件-Obsidian沙箱仓库",
        "source_files": [
            r"C:\Desktop\code\obsidian-form-flow-master\plugin\manifest.json",
            r"C:\Desktop\code\obsidian-form-flow-master\plugin\main.js",
            r"C:\Desktop\code\obsidian-form-flow-master\plugin\styles.css"
        ],
        "target_folder": r"C:\Code\Obsidian沙箱仓库\.obsidian\plugins\form-flow"
    }
    # 可以根据需要添加更多的文件对
}

def select_copy_mode():
    """
    让用户选择复制模式: 复制一对或复制所有
    """
    print("\n📋 请选择复制模式:")
    print("1. 复制特定一对文件")
    print("2. 复制所有文件对")
    
    while True:
        choice = input("请输入选项 (1/2): ").strip()
        if choice in ["1", "2"]:
            return int(choice)
        else:
            print("❌ 无效选项，请输入1或2。")


def select_file_pair():
    """
    让用户选择要复制的文件对
    """
    print("\n📋 可用文件对:")
    for i, (pair_id, pair_info) in enumerate(file_pairs.items(), 1):
        print(f"{i}. {pair_info['name']} (ID: {pair_id})")
    
    while True:
        try:
            choice = int(input("请输入要复制的文件对编号: ").strip())
            if 1 <= choice <= len(file_pairs):
                pair_ids = list(file_pairs.keys())
                return pair_ids[choice - 1]
            else:
                print(f"❌ 无效编号，请输入1到{len(file_pairs)}之间的数字。")
        except ValueError:
            print("❌ 无效输入，请输入数字。")


class FileChangeHandler(FileSystemEventHandler):
    """文件变化事件处理器"""
    def __init__(self, file_pairs, watch_pairs=None):
        super().__init__()
        self.file_pairs = file_pairs
        self.watch_pairs = watch_pairs or list(file_pairs.keys())
        self.last_triggered = {}
        # 初始化最后触发时间
        for pair_id in self.watch_pairs:
            self.last_triggered[pair_id] = 0
    
    def on_modified(self, event):
        """当文件被修改时触发"""
        if event.is_directory:
            return
            
        file_path = Path(event.src_path)
        
        # 检查哪个文件对包含了修改的文件
        for pair_id in self.watch_pairs:
            if pair_id not in self.file_pairs:
                continue
                
            pair = self.file_pairs[pair_id]
            
            # 检查修改的文件是否在源文件列表中
            for source_file in pair['source_files']:
                if file_path == Path(source_file):
                    current_time = time.time()
                    # 防止短时间内重复触发（例如一个文件保存可能触发多次事件）
                    if current_time - self.last_triggered[pair_id] < 2:  # 2秒内只触发一次
                        return
                        
                    self.last_triggered[pair_id] = current_time
                    print(f"\n🔄 检测到文件变动: {file_path.name}，开始自动复制...")
                    copy_files_with_replace(pair['source_files'], pair['target_folder'])
                    break


def start_auto_monitor(file_pairs, watch_pairs=None):
    """启动自动文件监控"""
    if watch_pairs is None:
        watch_pairs = list(file_pairs.keys())
        
    print("\n🔄 启动自动文件监控模式...")
    print("监控的文件对:")
    for pair_id in watch_pairs:
        pair = file_pairs[pair_id]
        print(f"  - {pair['name']}")
        print(f"    源文件: {', '.join([Path(f).name for f in pair['source_files']])}")
        print(f"    目标: {pair['target_folder']}")
    
    print("\n按 Ctrl+C 停止监控\n")
    
    # 创建事件处理器
    event_handler = FileChangeHandler(file_pairs, watch_pairs)
    
    # 创建观察者
    observer = Observer()
    
    # 为每个源文件所在的目录添加监控
    watched_dirs = set()
    for pair_id in watch_pairs:
        if pair_id not in file_pairs:
            continue
            
        pair = file_pairs[pair_id]
        for source_file in pair['source_files']:
            source_dir = str(Path(source_file).parent)
            if source_dir not in watched_dirs:
                watched_dirs.add(source_dir)
                observer.schedule(event_handler, source_dir, recursive=False)
    
    # 启动观察者
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        print("\n⏹️ 已停止文件监控")
    
    observer.join()


def select_watch_pairs():
    """让用户选择要监控的文件对"""
    print("\n📋 可用文件对:")
    for i, (pair_id, pair_info) in enumerate(file_pairs.items(), 1):
        print(f"{i}. {pair_info['name']} (ID: {pair_id})")
    
    print("\n请输入要监控的文件对编号（多个用逗号分隔，或输入'all'监控所有）:")
    
    while True:
        choice = input("选项: ").strip()
        if choice.lower() == 'all':
            return list(file_pairs.keys())
        
        try:
            indices = [int(idx.strip()) for idx in choice.split(',')]
            pair_ids = list(file_pairs.keys())
            selected_pairs = []
            
            for idx in indices:
                if 1 <= idx <= len(file_pairs):
                    selected_pairs.append(pair_ids[idx - 1])
                else:
                    print(f"❌ 无效编号: {idx}，请重新输入")
                    break
            else:
                return selected_pairs
        except ValueError:
            print("❌ 无效输入，请输入数字编号或'all'")


# 使用示例
if __name__ == "__main__":
    # 添加命令行参数支持
    parser = argparse.ArgumentParser(description="文件复制移动工具")
    parser.add_argument("--auto", action="store_true", help="启动自动监控模式")
    parser.add_argument("--pairs", help="指定要监控的文件对ID（多个用逗号分隔）")
    args = parser.parse_args()
    
    if args.auto:
        # 自动监控模式
        if args.pairs:
            watch_pairs = args.pairs.split(',')
            # 验证文件对ID是否存在
            invalid_pairs = [p for p in watch_pairs if p not in file_pairs]
            if invalid_pairs:
                print(f"❌ 无效的文件对ID: {', '.join(invalid_pairs)}")
                exit(1)
        else:
            watch_pairs = select_watch_pairs()
            
        start_auto_monitor(file_pairs, watch_pairs)
    else:
        # 手动模式
        mode = select_copy_mode()
        
        if mode == 1:
            # 复制特定一对
            pair_id = select_file_pair()
            pair = file_pairs[pair_id]
            print(f"\n🚀 开始复制: {pair['name']}")
            copy_files_with_replace(pair['source_files'], pair['target_folder'])
        else:
            # 复制所有对
            print("\n🚀 开始复制所有文件对")
            total_success = 0
            total_error = 0
            
            for pair_id, pair in file_pairs.items():
                print(f"\n🔄 处理文件对: {pair['name']}")
                # 临时重定向输出，以便获取成功和失败计数
                import io
                import sys
                
                old_stdout = sys.stdout
                sys.stdout = captured_output = io.StringIO()
                
                copy_files_with_replace(pair['source_files'], pair['target_folder'])
                
                sys.stdout = old_stdout
                output = captured_output.getvalue()
                
                # 解析输出获取成功和失败计数
                for line in output.splitlines():
                    if "成功: " in line and "失败: " in line:
                        parts = line.split()
                        success = int(parts[parts.index("成功:") + 1].replace(",", ""))
                        error = int(parts[parts.index("失败:") + 1].replace(",", ""))
                        total_success += success
                        total_error += error
                        break
            
            print(f"\n📊 所有文件对复制完成! 总成功: {total_success}, 总失败: {total_error}")
