#!/usr/bin/env python3

import argparse
from marpedConverter import MarpConverter

def main():
    parser = argparse.ArgumentParser(description='Convert Markdown to PDF using Marp')
    parser.add_argument('files', nargs='+', help='files to convert')
    
    args = parser.parse_args()
    
    converter = MarpConverter('pdf', ("--theme", "style-roboto-light-portrait", "--format", "portrait"), "-Comments")
    converter.convert_files(args.files)

if __name__ == "__main__":
    main()
