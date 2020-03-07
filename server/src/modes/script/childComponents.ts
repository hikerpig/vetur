import * as ts from 'typescript';
import { Range } from 'vscode-languageserver';
import {
  getLastChild,
  buildDocumentation,
  getNodeFromExportNode,
  getComponentDecoratorArgumentType,
  isClassType
} from './componentInfo';
import { T_TypeScript } from '../../services/dependencyService';

interface InternalChildComponent {
  name: string;
  documentation?: string;
  definition?: {
    path: string;
    range: Range;
  };
  defaultExportNode?: ts.Node;
}

export function getChildComponents(
  tsModule: T_TypeScript,
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  tagCasing = 'kebab'
): InternalChildComponent[] | undefined {
  let type = defaultExportType;
  if (isClassType(tsModule, type)) {
    // get decorator argument type when class
    const classDecoratorArgumentType = getComponentDecoratorArgumentType(tsModule, defaultExportType, checker);
    if (!classDecoratorArgumentType) {
      return undefined;
    }
    type = classDecoratorArgumentType;
  }

  const componentsSymbol = checker.getPropertyOfType(type, 'components');
  if (!componentsSymbol || !componentsSymbol.valueDeclaration) {
    return undefined;
  }

  const componentsDeclaration = getLastChild(componentsSymbol.valueDeclaration);
  if (!componentsDeclaration) {
    return undefined;
  }

  if (componentsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
    const componentsType = checker.getTypeOfSymbolAtLocation(componentsSymbol, componentsDeclaration);

    const result: InternalChildComponent[] = [];
    checker.getPropertiesOfType(componentsType).forEach(s => {
      if (!s.valueDeclaration) {
        return;
      }

      let componentName = s.name;
      if (tagCasing === 'kebab') {
        componentName = hyphenate(s.name);
      }

      let objectLiteralSymbol: ts.Symbol | undefined;
      if (s.valueDeclaration.kind === tsModule.SyntaxKind.PropertyAssignment) {
        objectLiteralSymbol =
          checker.getSymbolAtLocation((s.valueDeclaration as ts.PropertyAssignment).initializer) || s;
      } else if (s.valueDeclaration.kind === tsModule.SyntaxKind.ShorthandPropertyAssignment) {
        objectLiteralSymbol = checker.getShorthandAssignmentValueSymbol(s.valueDeclaration) || s;
      }

      if (!objectLiteralSymbol) {
        return;
      }

      if (objectLiteralSymbol.flags & tsModule.SymbolFlags.Alias) {
        const definitionSymbol = checker.getAliasedSymbol(objectLiteralSymbol);
        const decalration = definitionSymbol.valueDeclaration;
        if (tsModule.isClassDeclaration(definitionSymbol.valueDeclaration)) {
          const defaultExportNode = definitionSymbol.valueDeclaration;
          const sourceFile = defaultExportNode.getSourceFile();
          const definitionRange = Range.create(
            tsModule.getLineAndCharacterOfPosition(sourceFile, decalration.getStart()),
            tsModule.getLineAndCharacterOfPosition(sourceFile, decalration.getEnd())
          );
          result.push({
            name: componentName,
            documentation: buildDocumentation(tsModule, definitionSymbol, checker),
            definition: {
              path: definitionSymbol.valueDeclaration.getSourceFile().fileName,
              range: definitionRange
            },
            defaultExportNode: getNodeFromExportNode(tsModule, defaultExportNode)
          });
        } else if (definitionSymbol.valueDeclaration) {
          const defaultExportExpr = getLastChild(definitionSymbol.valueDeclaration);
          if (!defaultExportExpr) {
            return;
          }

          const sourceFile = defaultExportExpr.getSourceFile();
          // the range of the definition, not of the defaultExportExpr,
          // for the later one's start may be incorrect
          const definitionRange = Range.create(
            tsModule.getLineAndCharacterOfPosition(sourceFile, decalration.getStart()),
            tsModule.getLineAndCharacterOfPosition(sourceFile, decalration.getEnd())
          );
          result.push({
            name: componentName,
            documentation: buildDocumentation(tsModule, definitionSymbol, checker),
            definition: {
              path: definitionSymbol.valueDeclaration.getSourceFile().fileName,
              range: definitionRange
            },
            defaultExportNode: getNodeFromExportNode(tsModule, defaultExportExpr)
          });
        }
      }
    });

    return result;
  }
}

const hyphenateRE = /\B([A-Z])/g;
function hyphenate(word: string) {
  return word.replace(hyphenateRE, '-$1').toLowerCase();
}
